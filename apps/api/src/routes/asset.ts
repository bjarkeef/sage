import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { resolveAssetSlug } from "./asset-slug";
import type { AppEnv } from "../middleware/session";
import {
  Decimal,
  Money,
  computePositions,
  computeRetroactiveIncome,
  computeDividendCAGR,
  computeYieldOnCost,
  projectDividendSchedule,
  dedupeDividends,
  incomePaymentDates,
  type PositionTransaction,
  type DividendHistoryRow,
  type IncomeFrequencyUnit,
} from "@sage/core";
import type {
  IMarketDataProvider,
  IFxRateService,
  AssetProfile,
  AssetType,
} from "@sage/provider-interface";
import type { Database } from "../db/client";
import { instrument, transaction, dividendHistory, customHolding } from "../db/schema";
import { getUserPortfolio } from "../auth";
import { forwardFillChart } from "./chart-utils";
import type { IsinResolver } from "../market-data/isin-resolver";
import { getCachedOrFetchProfile } from "../market-data/asset-profile-cache";

const rangeSchema = z.enum(["1W", "1M", "3M", "YTD", "1Y", "ALL"]).default("1Y");

function rangeToDate(range: z.infer<typeof rangeSchema>): Date {
  const now = new Date();
  switch (range) {
    case "1W":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    case "1M":
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "3M":
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case "YTD":
      return new Date(now.getFullYear(), 0, 1);
    case "1Y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "ALL":
      return new Date("1970-01-01");
  }
}

export function assetRoutes(
  db: Database,
  provider: IMarketDataProvider,
  isinResolver?: IsinResolver,
  fxRateService?: IFxRateService,
) {
  const app = new Hono<AppEnv>();

  app.get("/:slug", async (c) => {
    const slug = decodeURIComponent(c.req.param("slug"));
    const symbol = await resolveAssetSlug(db, slug);
    const range = rangeSchema.parse(c.req.query("range"));
    const from = rangeToDate(range);
    const to = new Date();

    // 1. Profile (cached or fetched; fall back to primary listing or instrument row)
    const [inst] = await db.select().from(instrument).where(eq(instrument.symbol, symbol));

    let profile: AssetProfile;
    try {
      profile = await getCachedOrFetchProfile(db, provider, symbol);
    } catch {
      if (!inst) return c.json({ error: "not_found" }, 404);
      profile = {
        symbol: inst.symbol,
        name: inst.name,
        exchange: inst.exchange,
        currency: inst.currency,
        assetType: inst.assetType as AssetType,
        sector: null,
        industry: null,
        marketCap: null,
        peRatio: null,
        beta: null,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
        dividendYield: null,
        payoutRatio: null,
        trailingAnnualDividend: null,
        website: null,
        description: null,
        ceo: null,
        fullTimeEmployees: null,
        ipoDate: null,
        country: null,
        countryIso: null,
        fund: null,
      };
    }

    // Enrich from primary listing if key fundamentals are missing
    const needsEnrichment = profile.sector === null && profile.description === null;
    if (needsEnrichment && inst?.primarySymbol) {
      try {
        const primary = await getCachedOrFetchProfile(db, provider, inst.primarySymbol);
        profile = {
          ...profile,
          sector: profile.sector ?? primary.sector,
          industry: profile.industry ?? primary.industry,
          marketCap: profile.marketCap ?? primary.marketCap,
          peRatio: profile.peRatio ?? primary.peRatio,
          beta: profile.beta ?? primary.beta,
          fiftyTwoWeekHigh: profile.fiftyTwoWeekHigh ?? primary.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: profile.fiftyTwoWeekLow ?? primary.fiftyTwoWeekLow,
          dividendYield: profile.dividendYield ?? primary.dividendYield,
          payoutRatio: profile.payoutRatio ?? primary.payoutRatio,
          trailingAnnualDividend: profile.trailingAnnualDividend ?? primary.trailingAnnualDividend,
          website: profile.website ?? primary.website,
          description: profile.description ?? primary.description,
          ceo: profile.ceo ?? primary.ceo,
          fullTimeEmployees: profile.fullTimeEmployees ?? primary.fullTimeEmployees,
          ipoDate: profile.ipoDate ?? primary.ipoDate,
          country: profile.country ?? primary.country,
          countryIso: profile.countryIso ?? primary.countryIso,
        };
      } catch {
        // Primary listing enrichment failed — keep what we have
      }
    }

    // Lazy ISIN resolution: trigger in background if ISIN is null
    if (inst && !inst.isin && isinResolver) {
      isinResolver.resolveAndStore(db, symbol).catch(() => {});
    }

    // 2-4. Quote, chart and dividend history. None of the three reads the
    // others' output and two are provider round-trips, so running them in
    // sequence charged the page the sum of three latencies for no reason.
    // Each keeps its own catch: a failed quote must not cost the chart.
    const [quote, chart, divRows] = await Promise.all([
      (async (): Promise<{ price: { amount: string; currency: string }; asOf: string } | null> => {
        try {
          const q = await provider.getQuote(symbol);
          return { price: q.price.toJSON(), asOf: q.asOf.toISOString().slice(0, 10) };
        } catch {
          return null;
        }
      })(),
      (async (): Promise<{ date: string; close: { amount: string; currency: string } }[]> => {
        try {
          const bars = await provider.getHistoricalPrices(symbol, from, to);
          return forwardFillChart(
            bars.map((b) => ({
              date: b.date.toISOString().slice(0, 10),
              close: b.close.toJSON(),
            })),
          );
        } catch {
          return [];
        }
      })(),
      db
        .select()
        .from(dividendHistory)
        .where(eq(dividendHistory.symbol, symbol))
        .orderBy(desc(dividendHistory.exDate)),
    ]);

    // Collapse the same payment reported by multiple providers a few days apart,
    // so trailing-12m totals, CAGR and income don't double-count annual payers.
    const divHistory: DividendHistoryRow[] = dedupeDividends(
      divRows.map((d) => ({
        symbol: d.symbol,
        exDate: d.exDate,
        amountPerShare: d.amountPerShare,
        currency: d.currency,
      })),
    );
    const keptExDates = new Set(divHistory.map((d) => d.exDate));

    // 5. Dividend CAGR and trailing 12m total
    const asOf = new Date();
    const cagr5y = computeDividendCAGR(divHistory, 5, asOf);
    const oneYearAgo = new Date(asOf);
    oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    // Dedupe near-duplicate payments (same dividend reported by multiple
    // providers a few days apart) before summing, so the trailing total can't
    // double-count — matching computeYieldOnCost's numerator exactly.
    const inWindowDivs = dedupeDividends(
      divHistory.filter((d) => {
        const exDate = new Date(`${d.exDate}T00:00:00Z`);
        return exDate > oneYearAgo && exDate <= asOf;
      }),
    );
    const trailing12m = inWindowDivs.reduce(
      (sum, d) => sum.plus(new Decimal(d.amountPerShare)),
      new Decimal(0),
    );

    // Native-currency dividend currency (deduped history is sorted asc; last = latest).
    const divCurrency =
      inWindowDivs[0]?.currency ?? divHistory.at(-1)?.currency ?? profile.currency;
    // A redenomination or primary-listing change can mix currencies within the
    // trailing window; when that happens, trailing12m is not a single-currency
    // total and must not be divided by a price or surfaced as annualDividend.
    const divCurrencyUniform = inWindowDivs.every((d) => d.currency === divCurrency);

    // Current yield: trailing TTM per share ÷ live price, same currency by
    // construction. Falls back to the profile's cached yield when there is no
    // live quote, no trailing dividend, or a currency mismatch (never divide
    // across currencies).
    const livePrice = quote ? new Decimal(quote.price.amount) : null;
    let currentYield: number | null = null;
    if (
      livePrice &&
      !livePrice.isZero() &&
      trailing12m.greaterThan(0) &&
      divCurrencyUniform &&
      divCurrency === quote?.price.currency
    ) {
      currentYield = Number(trailing12m.dividedBy(livePrice).toFixed(6));
    } else if (profile.dividendYield && profile.dividendYield.greaterThan(0)) {
      currentYield = Number(profile.dividendYield.toFixed(6));
    }

    // Next projected ex-date from cadence (quantity irrelevant here; use 1).
    // Overridden below when this is a custom holding with a contractual schedule.
    const exSchedule = projectDividendSchedule({
      symbol,
      quantity: new Decimal(1),
      history: divHistory,
      announced: [],
      asOf,
    });
    let nextExDate = exSchedule[0]?.exDate ?? null;
    let annualDividend: { amount: string; currency: string } | null =
      trailing12m.greaterThan(0) && divCurrencyUniform
        ? { amount: trailing12m.toFixed(), currency: divCurrency }
        : null;

    // 6. User position
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const txRows = await db
      .select()
      .from(transaction)
      .where(
        and(eq(transaction.portfolioId, portfolioId), eq(transaction.instrumentSymbol, symbol)),
      );

    let heldYieldOnCost: number | null = null;
    let positionDTO: Record<string, unknown> = { held: false };

    if (txRows.length > 0) {
      const txs: PositionTransaction[] = txRows.map((row) => ({
        symbol: row.instrumentSymbol,
        type: row.type as PositionTransaction["type"],
        quantity: new Decimal(row.quantity),
        price: Money.of(row.price, row.currency),
        tradeDate: new Date(`${row.tradeDate}T00:00:00Z`),
      }));

      const positions = computePositions(txs);
      const pos = positions.find((p) => p.symbol === symbol);

      if (pos) {
        let marketValue: Money | null = null;
        let gainLoss: Money | null = null;
        let gainLossPercent: number | null = null;

        if (quote) {
          const price = Money.of(quote.price.amount, quote.price.currency);
          marketValue = price.times(pos.quantity);
          gainLoss = marketValue.minus(pos.costBasis);
          if (!pos.costBasis.isZero()) {
            gainLossPercent = Number(
              gainLoss.toDecimal().dividedBy(pos.costBasis.toDecimal()).times(100).toFixed(4),
            );
          }
        }

        const retroactive = computeRetroactiveIncome(txs, divHistory);
        const totalDivIncome = retroactive.reduce(
          (sum, r) => sum.plus(new Decimal(r.income)),
          new Decimal(0),
        );

        // Optional FX: convert dividend APS into the cost currency when they
        // differ (dual-listed / ADR-style payers). Prefetch pair rates; failure
        // for any in-window foreign dividend → null YoC (no mixed-unit %).
        let yocConvert: ((amount: Decimal, from: string, to: string) => Decimal | null) | undefined;
        if (fxRateService) {
          const costCcy = pos.averageCost.currency;
          const foreignDivCcys = [
            ...new Set(divHistory.map((d) => d.currency).filter((c) => c !== costCcy)),
          ];
          if (foreignDivCcys.length > 0) {
            const rateCache = new Map<string, Decimal | null>();
            await Promise.all(
              foreignDivCcys.map(async (from) => {
                try {
                  // getRate(from, to) = units of `to` per 1 unit of `from`.
                  rateCache.set(`${from}->${costCcy}`, await fxRateService.getRate(from, costCcy));
                } catch {
                  rateCache.set(`${from}->${costCcy}`, null);
                }
              }),
            );
            yocConvert = (amount, from, to) => {
              if (from === to) return amount;
              const rate = rateCache.get(`${from}->${to}`);
              if (rate == null || rate.isZero()) return null;
              return amount.times(rate);
            };
          }
        }
        const yoc = computeYieldOnCost(divHistory, pos.averageCost, asOf, yocConvert);
        const yieldOnCost = yoc ? Number(yoc.toFixed(6)) : null;

        // Fees: sum of transaction fees for this symbol.
        const feesTotal = txRows.reduce(
          (s, r) => (r.fee ? s.plus(new Decimal(r.fee)) : s),
          new Decimal(0),
        );
        const feeCcy =
          txRows.find((r) => r.feeCurrency)?.feeCurrency ?? txRows[0]?.currency ?? profile.currency;

        // Forward 12-month income for this holding (projected + none announced).
        const incomeSchedule = projectDividendSchedule({
          symbol,
          quantity: pos.quantity,
          history: divHistory,
          announced: [],
          asOf,
        });
        const forward = incomeSchedule.reduce(
          (s, r) => s.plus(new Decimal(r.income)),
          new Decimal(0),
        );
        const forwardAnnualIncome =
          incomeSchedule.length > 0
            ? { amount: forward.toFixed(2), currency: incomeSchedule[0]!.currency }
            : null;

        // Buy/sell markers, ascending by trade date (dividends/splits excluded).
        const trades = txRows
          .filter((r) => r.type === "buy" || r.type === "sell")
          .map((r) => ({
            tradeDate: r.tradeDate,
            type: r.type as "buy" | "sell",
            price: r.price,
            quantity: r.quantity,
          }))
          .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

        heldYieldOnCost = yieldOnCost;

        positionDTO = {
          held: true,
          quantity: pos.quantity.toFixed(),
          averageCost: pos.averageCost.toJSON(),
          costBasis: pos.costBasis.toJSON(),
          marketValue: marketValue?.toJSON() ?? null,
          unrealizedGainLoss: gainLoss?.toJSON() ?? null,
          gainLossPercent,
          totalDividendIncome: totalDivIncome.toFixed(),
          yieldOnCost,
          feesPaid: { amount: feesTotal.toFixed(), currency: feeCcy },
          forwardAnnualIncome,
          trades,
        };
      }
    }

    // 7. Custom holding settings — present only for user-defined instruments
    // (discriminated by a customHolding row, not profile.assetType: the
    // provider's AssetType enum has no "custom" value and maps it to "other").
    type AssetCustomIncomeDTO = {
      yearlyPct: string;
      frequencyUnit: string;
      frequencyInterval: number;
      firstPaymentDate: string;
      lastPaymentDate: string | null;
      reinvest: boolean;
      nextPaymentDate: string | null;
    };
    let customDTO: {
      holdingType: string;
      note: string | null;
      income: AssetCustomIncomeDTO | null;
    } | null = null;

    const [customRow] = await db
      .select()
      .from(customHolding)
      .where(and(eq(customHolding.symbol, symbol), eq(customHolding.portfolioId, portfolioId)));

    if (customRow) {
      let incomeDTO: AssetCustomIncomeDTO | null = null;
      if (
        customRow.incomeEnabled &&
        customRow.incomeYearlyPct != null &&
        customRow.frequencyUnit != null &&
        customRow.firstPaymentDate != null
      ) {
        // nextPaymentDate = first scheduled date strictly after today, walking
        // the schedule out to one year from now; null once the schedule is
        // exhausted (past lastPaymentDate) within that window. Wrapped in
        // try/catch so a malformed row (e.g. a bad interval) never 500s the
        // asset route — incomePaymentDates throws on interval < 1.
        try {
          const today = asOf.toISOString().slice(0, 10);
          const untilDate = new Date(asOf);
          untilDate.setUTCFullYear(untilDate.getUTCFullYear() + 1);
          const until = untilDate.toISOString().slice(0, 10);
          const dates = incomePaymentDates({
            firstPaymentDate: customRow.firstPaymentDate,
            lastPaymentDate: customRow.lastPaymentDate,
            unit: customRow.frequencyUnit as IncomeFrequencyUnit,
            interval: customRow.frequencyInterval,
            until,
          });
          const nextPaymentDate = dates.find((d) => d > today) ?? null;
          incomeDTO = {
            yearlyPct: customRow.incomeYearlyPct,
            frequencyUnit: customRow.frequencyUnit,
            frequencyInterval: customRow.frequencyInterval,
            firstPaymentDate: customRow.firstPaymentDate,
            lastPaymentDate: customRow.lastPaymentDate,
            reinvest: customRow.reinvest,
            nextPaymentDate,
          };
        } catch {
          incomeDTO = {
            yearlyPct: customRow.incomeYearlyPct,
            frequencyUnit: customRow.frequencyUnit,
            frequencyInterval: customRow.frequencyInterval,
            firstPaymentDate: customRow.firstPaymentDate,
            lastPaymentDate: customRow.lastPaymentDate,
            reinvest: customRow.reinvest,
            nextPaymentDate: null,
          };
        }
      }
      customDTO = {
        holdingType: customRow.holdingType,
        note: customRow.note,
        income: incomeDTO,
      };
    }

    // Profile DTO
    const profileDTO = {
      symbol: profile.symbol,
      name: profile.name,
      exchange: profile.exchange,
      currency: profile.currency,
      assetType: profile.assetType,
      sector: profile.sector,
      industry: profile.industry,
      marketCap: profile.marketCap?.toFixed() ?? null,
      peRatio: profile.peRatio?.toFixed() ?? null,
      beta: profile.beta?.toFixed() ?? null,
      fiftyTwoWeekHigh: profile.fiftyTwoWeekHigh?.toJSON() ?? null,
      fiftyTwoWeekLow: profile.fiftyTwoWeekLow?.toJSON() ?? null,
      dividendYield: profile.dividendYield?.toFixed() ?? null,
      trailingAnnualDividend: profile.trailingAnnualDividend?.toJSON() ?? null,
      website: profile.website,
      description: profile.description,
      ceo: profile.ceo,
      fullTimeEmployees: profile.fullTimeEmployees,
      ipoDate: profile.ipoDate,
      country: profile.country,
      countryIso: profile.countryIso,
      fund: profile.fund
        ? {
            expenseRatio: profile.fund.expenseRatio?.toFixed() ?? null,
            totalAssets: profile.fund.totalAssets?.toFixed() ?? null,
            family: profile.fund.family,
            category: profile.fund.category,
            legalType: profile.fund.legalType,
            holdings: profile.fund.holdings,
            sectorWeightings: profile.fund.sectorWeightings,
          }
        : null,
    };

    // Custom holdings with a contractual income rate must not use the stock
    // path (trailing TTM ÷ price / history-inferred next ex). A savings account
    // held for a few months only has a partial year of interest payments in
    // dividend_history, so TTM understates the configured rate (e.g. 0.44% vs
    // 4.25%). Prefer the settings the user entered.
    if (customDTO?.income) {
      const rate = new Decimal(customDTO.income.yearlyPct).dividedBy(100);
      currentYield = Number(rate.toFixed(6));
      // Reinvest credits (price-0 buys) drag FIFO average cost down and would
      // inflate a price/cost YoC; the contractual rate is what the holding pays.
      heldYieldOnCost = currentYield;
      if (customDTO.income.nextPaymentDate) {
        nextExDate = customDTO.income.nextPaymentDate;
      }
      const priceForAnnual =
        livePrice && !livePrice.isZero()
          ? livePrice
          : // Cash-style customs usually mark at 1; without a quote still surface rate × 1.
            new Decimal(1);
      const annualPerShare = priceForAnnual.times(rate);
      const annualCcy = quote?.price.currency ?? profile.currency;
      annualDividend = { amount: annualPerShare.toFixed(4), currency: annualCcy };
      if ((positionDTO as { held?: boolean }).held) {
        (positionDTO as { yieldOnCost: number | null }).yieldOnCost = heldYieldOnCost;
        const qtyStr = (positionDTO as { quantity?: string }).quantity;
        if (qtyStr) {
          const forward = new Decimal(qtyStr).times(priceForAnnual).times(rate);
          (
            positionDTO as {
              forwardAnnualIncome: { amount: string; currency: string } | null;
            }
          ).forwardAnnualIncome = {
            amount: forward.toFixed(2),
            currency: annualCcy,
          };
        }
      }
    }

    const income = {
      currentYield,
      yieldOnCost: heldYieldOnCost,
      annualDividend,
      dividendGrowth5y: cagr5y?.toFixed(6) ?? null,
      nextExDate,
      payoutRatio: profile.payoutRatio != null ? Number(profile.payoutRatio.toFixed(6)) : null,
    };

    return c.json({
      profile: profileDTO,
      quote,
      chart,
      dividends: {
        // List the deduped set so legacy rows not yet cleaned at ingestion
        // don't surface the same payment twice.
        history: divRows
          .filter((d) => keptExDates.has(d.exDate))
          .map((d) => ({
            exDate: d.exDate,
            amountPerShare: d.amountPerShare,
            currency: d.currency,
            paymentDate: d.paymentDate,
          })),
        cagr5y: cagr5y?.toFixed(6) ?? null,
        trailingTwelveMonthTotal: trailing12m.toFixed(),
      },
      position: positionDTO,
      income,
      custom: customDTO,
    });
  });

  app.get("/:slug/chart", async (c) => {
    const slug = decodeURIComponent(c.req.param("slug"));
    const symbol = await resolveAssetSlug(db, slug);
    const range = rangeSchema.parse(c.req.query("range"));
    const from = rangeToDate(range);
    const to = new Date();

    let chart: { date: string; close: { amount: string; currency: string } }[] = [];
    try {
      const bars = await provider.getHistoricalPrices(symbol, from, to);
      chart = forwardFillChart(
        bars.map((b) => ({
          date: b.date.toISOString().slice(0, 10),
          close: b.close.toJSON(),
        })),
      );
    } catch {
      chart = [];
    }

    return c.json({ chart });
  });

  return app;
}
