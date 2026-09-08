import { and, eq, inArray } from "drizzle-orm";
import {
  Decimal,
  Money,
  computeYieldOnCost,
  computeRetroactiveIncome,
  dedupeDividends,
  resolveSplitBasis,
  type Position,
  type DividendHistoryRow,
} from "@sage/core";
import type { IMarketDataProvider, IFxRateService } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { instrument, dividendHistory, assetProfile, customHolding } from "../db/schema";
import { loadPortfolioBook, type PortfolioBook } from "./portfolio-book";
import { getRatesWithProvenance } from "../market-data/fx-provenance";
import { findBasisMismatches, toBasisFindingBody } from "./basis-reconciliation";
import { resolveDisplayName } from "./display-name";

interface PricedPosition {
  position: Position;
  currentPrice: Money | null;
  previousClose: Money | null;
  marketValue: Money | null;
  gainLoss: Money | null;
}

export interface PortfolioViewDeps {
  db: Database;
  provider: IMarketDataProvider;
  fxRateService?: IFxRateService;
}

export async function buildPortfolioView(
  deps: PortfolioViewDeps,
  userId: string,
  opts: { currency?: string | null; book?: PortfolioBook },
) {
  const { db, provider, fxRateService } = deps;
  const book =
    opts.book ?? (await loadPortfolioBook(db, userId, { currency: opts.currency ?? null }));
  const { targetCurrency, txs, positions } = book;
  const heldForLookup = positions.map((p) => p.symbol);

  const instruments =
    heldForLookup.length > 0
      ? await db.select().from(instrument).where(inArray(instrument.symbol, heldForLookup))
      : [];
  const nameBySymbol = new Map(instruments.map((i) => [i.symbol, i.name]));
  const exchangeBySymbol = new Map(instruments.map((i) => [i.symbol, i.exchange]));

  const priced: PricedPosition[] = await Promise.all(
    positions.map(async (position) => {
      try {
        const quote = await provider.getQuote(position.symbol);
        const marketValue = quote.price.times(position.quantity);
        return {
          position,
          currentPrice: quote.price,
          previousClose: quote.previousClose,
          marketValue,
          gainLoss: marketValue.minus(position.costBasis),
        };
      } catch {
        return {
          position,
          currentPrice: null,
          previousClose: null,
          marketValue: null,
          gainLoss: null,
        };
      }
    }),
  );

  const asOf = new Date();
  const heldSymbols = positions.map((p) => p.symbol);

  // Full dividend history per held symbol; computeYieldOnCost windows it to the
  // trailing twelve months (excluding any future ex-dates) and is currency-aware.
  const divsBySymbol = new Map<string, DividendHistoryRow[]>();
  if (heldSymbols.length > 0) {
    const divRows = await db
      .select()
      .from(dividendHistory)
      .where(inArray(dividendHistory.symbol, heldSymbols));
    for (const d of divRows) {
      const list = divsBySymbol.get(d.symbol) ?? [];
      list.push({
        symbol: d.symbol,
        exDate: d.exDate,
        amountPerShare: d.amountPerShare,
        currency: d.currency,
        paymentDate: d.paymentDate,
      });
      divsBySymbol.set(d.symbol, list);
    }
  }

  const todayIso = asOf.toISOString().slice(0, 10);

  // Retroactive dividend income per symbol (native currency), deduped so the
  // same payment reported by multiple providers isn't counted twice. "Received"
  // = cash that has actually landed, so a dividend whose payment date is still
  // ahead (ex-passed-but-unpaid) is excluded — it must not inflate a holding's
  // dividend income or total return. Mirrors the dividend income view's
  // trailing-received semantics. This is synthetic (provider history × held
  // shares) BY DESIGN — dividend `transaction` rows (including reconciliation's
  // source='auto' rows) are the performance view's cash flows only and must
  // never be summed in here, or every payment double-counts.
  const dedupedDivs = dedupeDividends([...divsBySymbol.values()].flat());
  const receivedDivs = dedupedDivs.filter((d) => (d.paymentDate ?? d.exDate) <= todayIso);
  const retroIncome = computeRetroactiveIncome(txs, receivedDivs);

  // Company website per held symbol, for logo rendering on the client.
  const websiteBySymbol = new Map<string, string | null>();
  const profileNameBySymbol = new Map<string, string | null>();
  if (heldSymbols.length > 0) {
    const profileRows = await db
      .select({
        symbol: assetProfile.symbol,
        website: assetProfile.website,
        name: assetProfile.name,
      })
      .from(assetProfile)
      .where(inArray(assetProfile.symbol, heldSymbols));
    for (const p of profileRows) {
      websiteBySymbol.set(p.symbol, p.website);
      profileNameBySymbol.set(p.symbol, p.name);
    }
  }

  // Contractual income rate for custom holdings (e.g. savings 4.25%). Used for
  // yield-on-cost instead of trailing TTM history, which understates a young
  // account that has only a fraction of a year of interest payments recorded.
  const customYieldBySymbol = new Map<string, Decimal>();
  if (heldSymbols.length > 0) {
    const customRows = await db
      .select({
        symbol: customHolding.symbol,
        incomeYearlyPct: customHolding.incomeYearlyPct,
        incomeEnabled: customHolding.incomeEnabled,
      })
      .from(customHolding)
      .where(
        and(
          eq(customHolding.portfolioId, book.portfolioId),
          inArray(customHolding.symbol, heldSymbols),
        ),
      );
    for (const row of customRows) {
      if (!row.incomeEnabled || row.incomeYearlyPct == null) continue;
      customYieldBySymbol.set(row.symbol, new Decimal(row.incomeYearlyPct).dividedBy(100));
    }
  }

  // FX conversion helper. Include dividend-history currencies so yield-on-cost
  // can convert APS face values into the position's cost currency (e.g. a
  // dual-listed name paying USD while cost basis is EUR).
  const fxRates = new Map<string, Decimal>();
  let fxStale = false;
  let fxRatesAsOf: string | null = null;
  if (targetCurrency && fxRateService) {
    const sourceCurrencies = new Set<string>();
    for (const p of positions) sourceCurrencies.add(p.currency);
    for (const divs of divsBySymbol.values()) {
      for (const d of divs) sourceCurrencies.add(d.currency);
    }
    sourceCurrencies.delete(targetCurrency);
    if (sourceCurrencies.size > 0) {
      try {
        const { rates, stale, asOf } = await getRatesWithProvenance(fxRateService, targetCurrency, [
          ...sourceCurrencies,
        ]);
        for (const [ccy, rate] of rates) fxRates.set(ccy, rate);
        fxStale = stale;
        fxRatesAsOf = asOf;
      } catch {
        // FX unavailable — fall through without conversion
      }
    }
  }

  function convertMoney(m: Money, fromCurrency: string): { amount: string; currency: string } {
    if (!targetCurrency || fromCurrency === targetCurrency || !fxRates.has(fromCurrency)) {
      // Keep the native currency label when conversion is not possible — never
      // advertise targetCurrency on an unconverted amount.
      return m.toJSON();
    }
    const rate = fxRates.get(fromCurrency)!;
    const converted = m.toDecimal().dividedBy(rate);
    return { amount: converted.toFixed(2), currency: targetCurrency };
  }

  /** Position-level display currency: target only when this position converted. */
  function positionDisplayCcy(nativeCcy: string): string {
    if (!targetCurrency) return nativeCcy;
    if (nativeCcy === targetCurrency) return targetCurrency;
    return fxRates.has(nativeCcy) ? targetCurrency : nativeCcy;
  }

  // Portfolio-level today change: sum converted dailyChange and marketValue,
  // grouped by the DTO's converted currency. Only a set that resolves to a
  // single currency (the common case: a display currency is set, or every
  // position already shares one native currency) yields a non-null result.
  const todayChangeByCurrency = new Map<string, { dailyChange: Decimal; marketValue: Decimal }>();

  // Computed once per request: a basis mismatch belongs to the book, not to a
  // position, so every consumer reads the same verdict.
  const { findings, checkedBySymbol } = await findBasisMismatches({ db, fxRateService }, userId);
  // Same deterministic verdict the valuation series reaches on the same book —
  // agreement comes from the function, not from a shared instance. A corrected
  // symbol needs no warning, and a permanent banner on a fixed holding would
  // train the reader to ignore banners.
  const splitBasis = resolveSplitBasis(txs, findings, checkedBySymbol);
  const basisFindings = findings
    .filter((f) => splitBasis.verdictOf(f.symbol) !== "adjusted")
    .map(toBasisFindingBody);
  const basisBySymbol = new Map(basisFindings.map((f) => [f.symbol, f]));

  const positionsDTO = priced.map(
    ({ position, currentPrice, previousClose, marketValue, gainLoss }) => {
      // Dividends received while holding, in the position's own currency. Only
      // same-currency rows count, mirroring the yield-on-cost convention.
      const dividendIncomeNative = retroIncome
        .filter((r) => r.symbol === position.symbol && r.currency === position.currency)
        .reduce((sum, r) => sum.plus(new Decimal(r.income)), new Decimal(0));

      // Day-over-day change from the prior session's close (a price ratio, so
      // currency-agnostic) and its value impact across the holding.
      const dailyChangeMoney =
        currentPrice && previousClose
          ? currentPrice.minus(previousClose).times(position.quantity)
          : null;
      const dailyChangePercent =
        currentPrice && previousClose && !previousClose.isZero()
          ? Number(
              currentPrice
                .toDecimal()
                .minus(previousClose.toDecimal())
                .dividedBy(previousClose.toDecimal())
                .times(100)
                .toFixed(4),
            )
          : null;
      const dailyChangeDTO = dailyChangeMoney
        ? convertMoney(dailyChangeMoney, position.currency)
        : null;
      const marketValueDTO = marketValue ? convertMoney(marketValue, position.currency) : null;
      if (dailyChangeDTO && marketValueDTO) {
        const entry = todayChangeByCurrency.get(dailyChangeDTO.currency) ?? {
          dailyChange: new Decimal(0),
          marketValue: new Decimal(0),
        };
        entry.dailyChange = entry.dailyChange.plus(new Decimal(dailyChangeDTO.amount));
        entry.marketValue = entry.marketValue.plus(new Decimal(marketValueDTO.amount));
        todayChangeByCurrency.set(dailyChangeDTO.currency, entry);
      }

      // Total return = unrealized gain/loss + dividends received.
      const totalReturnNative =
        gainLoss != null ? gainLoss.toDecimal().plus(dividendIncomeNative) : null;
      const totalReturnPercent =
        totalReturnNative != null && !position.costBasis.isZero()
          ? Number(
              totalReturnNative.dividedBy(position.costBasis.toDecimal()).times(100).toFixed(4),
            )
          : null;

      return {
        symbol: position.symbol,
        name: resolveDisplayName(
          position.symbol,
          nameBySymbol.get(position.symbol) ?? null,
          profileNameBySymbol.get(position.symbol) ?? null,
        ),
        exchange: exchangeBySymbol.get(position.symbol) ?? "",
        currency: positionDisplayCcy(position.currency),
        // The currency this position's buy lots are actually recorded in.
        // `currency` above is a *display* choice and may differ, so anything
        // writing back to the ledger (a quick-add from a holdings row) has to
        // use this one — the API refuses a buy or sell whose currency
        // disagrees with the holding's existing buys and sells.
        nativeCurrency: position.currency,
        quantity: position.quantity.toFixed(),
        averageCost: convertMoney(position.averageCost, position.currency),
        costBasis: convertMoney(position.costBasis, position.currency),
        currentPrice: currentPrice ? convertMoney(currentPrice, position.currency) : null,
        marketValue: marketValueDTO,
        unrealizedGainLoss: gainLoss ? convertMoney(gainLoss, position.currency) : null,
        gainLossPercent:
          gainLoss && !position.costBasis.isZero()
            ? Number(
                gainLoss
                  .toDecimal()
                  .dividedBy(position.costBasis.toDecimal())
                  .times(100)
                  .toFixed(4),
              )
            : null,
        dailyChange: dailyChangeDTO,
        dailyChangePercent,
        dividendIncome: dividendIncomeNative.isZero()
          ? null
          : convertMoney(Money.of(dividendIncomeNative, position.currency), position.currency),
        totalReturn:
          totalReturnNative != null
            ? convertMoney(Money.of(totalReturnNative, position.currency), position.currency)
            : null,
        totalReturnPercent,
        website: websiteBySymbol.get(position.symbol) ?? null,
        yieldOnCost: (() => {
          // Prefer the configured custom rate over trailing TTM history (partial
          // year of interest understates e.g. 4.25% as ~0.44%).
          const contractual = customYieldBySymbol.get(position.symbol);
          if (contractual) return Number(contractual.toFixed(6));
          const divs = divsBySymbol.get(position.symbol);
          if (!divs) return null;
          // Convert foreign-currency dividends into the position's cost
          // currency via display-currency cross rates when available. Without
          // a rate, computeYieldOnCost returns null rather than mixing units.
          const convert =
            targetCurrency && fxRates.size > 0
              ? (amount: Decimal, from: string, to: string): Decimal | null => {
                  if (from === to) return amount;
                  // amount_in_target = amount / rate[source]  (rate = source per target)
                  if (to === targetCurrency && fxRates.has(from)) {
                    return amount.dividedBy(fxRates.get(from)!);
                  }
                  if (from === targetCurrency && fxRates.has(to)) {
                    return amount.times(fxRates.get(to)!);
                  }
                  if (fxRates.has(from) && fxRates.has(to)) {
                    // from → display → to
                    return amount.dividedBy(fxRates.get(from)!).times(fxRates.get(to)!);
                  }
                  return null;
                }
              : undefined;
          const y = computeYieldOnCost(divs, position.averageCost, asOf, convert);
          return y ? Number(y.toFixed(6)) : null;
        })(),
        basisMismatch: basisBySymbol.get(position.symbol) ?? null,
      };
    },
  );

  let todayChange: { amount: { amount: string; currency: string }; percent: number } | null = null;
  const soleTodayChangeEntry =
    todayChangeByCurrency.size === 1 ? [...todayChangeByCurrency.entries()][0] : undefined;
  if (soleTodayChangeEntry) {
    const [currency, totals] = soleTodayChangeEntry;
    const denominator = totals.marketValue.minus(totals.dailyChange);
    if (!denominator.isZero()) {
      todayChange = {
        amount: { amount: totals.dailyChange.toFixed(2), currency },
        percent: Number(totals.dailyChange.dividedBy(denominator).times(100).toFixed(2)),
      };
    }
  }

  // Portfolio-level total return (price gain/loss + dividends), summed from the
  // already-converted per-position figures. Only positions with a computable
  // totalReturn contribute to BOTH numerator and denominator, so the percent
  // stays consistent with each row's own totalReturnPercent. Null when there's
  // no display currency at all (nothing to unify figures into).
  //
  // Deviation from a naive `fxRates.size > 0` gate (which mirrors the unified
  // subtotal below): that gate is false whenever every position is *already*
  // in targetCurrency — a single-currency portfolio never populates fxRates,
  // since there's no foreign currency to fetch a rate for — which would wrongly
  // null out totalReturn for the common single-currency case. Instead, filter
  // per position on `p.totalReturn.currency === targetCurrency`, which
  // convertMoney guarantees whenever a position's currency already matches
  // (no conversion needed) or was successfully converted; conversion is
  // all-or-nothing per call (the try/catch above fetches all source
  // currencies at once), so a position only fails this check when FX
  // conversion for its currency was unavailable — correctly excluding it
  // rather than silently mixing currencies.
  function computeTotalReturn(): {
    amount: { amount: string; currency: string };
    percent: number;
  } | null {
    if (!targetCurrency) return null;
    let ret = new Decimal(0);
    let basis = new Decimal(0);
    for (const p of positionsDTO) {
      if (!p.totalReturn || p.totalReturn.currency !== targetCurrency) continue;
      ret = ret.plus(new Decimal(p.totalReturn.amount));
      basis = basis.plus(new Decimal(p.costBasis.amount));
    }
    if (basis.isZero()) return null;
    return {
      amount: { amount: ret.toFixed(2), currency: targetCurrency },
      percent: Number(ret.dividedBy(basis).times(100).toFixed(2)),
    };
  }
  const totalReturn = computeTotalReturn();

  if (targetCurrency && fxRates.size > 0) {
    // Single unified subtotal when display currency is active. Never invent a
    // 1:1 rate for a missing pair — skip those positions and flag incompleteness
    // (same honesty contract as categories/diversification).
    let totalCostBasis = new Decimal(0);
    let totalMarketValue = new Decimal(0);
    let totalGainLoss = new Decimal(0);
    let fxIncomplete = false;
    for (const { position, marketValue, gainLoss } of priced) {
      const rate =
        position.currency === targetCurrency ? new Decimal(1) : fxRates.get(position.currency);
      if (!rate) {
        fxIncomplete = true;
        continue;
      }
      totalCostBasis = totalCostBasis.plus(position.costBasis.toDecimal().dividedBy(rate));
      if (marketValue)
        totalMarketValue = totalMarketValue.plus(marketValue.toDecimal().dividedBy(rate));
      if (gainLoss) totalGainLoss = totalGainLoss.plus(gainLoss.toDecimal().dividedBy(rate));
    }
    const subtotalsByCurrency = [
      {
        currency: targetCurrency,
        costBasis: { amount: totalCostBasis.toFixed(2), currency: targetCurrency },
        marketValue: { amount: totalMarketValue.toFixed(2), currency: targetCurrency },
        gainLoss: { amount: totalGainLoss.toFixed(2), currency: targetCurrency },
      },
    ];
    return {
      body: {
        positions: positionsDTO,
        subtotalsByCurrency,
        fxIncomplete,
        fxStale,
        fxRatesAsOf,
        basisMismatches: basisFindings,
        unverifiedSplits: splitBasis.unverified,
      },
      targetCurrency,
      todayChange,
      totalReturn,
    };
  }

  // Native per-currency subtotals (no display currency set)
  const currencies = [...new Set(priced.map((p) => p.position.currency))];
  const subtotalsByCurrency = currencies.map((currency) => {
    const inCcy = priced.filter((p) => p.position.currency === currency);
    const pricedInCcy = inCcy.filter((p) => p.marketValue !== null);
    const costBasis = Money.sum(
      inCcy.map((p) => p.position.costBasis),
      currency,
    );
    const marketValue = Money.sum(
      pricedInCcy.map((p) => p.marketValue as Money),
      currency,
    );
    const gainLoss = Money.sum(
      pricedInCcy.map((p) => p.gainLoss as Money),
      currency,
    );
    return {
      currency,
      costBasis: costBasis.toJSON(),
      marketValue: marketValue.toJSON(),
      gainLoss: gainLoss.toJSON(),
    };
  });

  return {
    // Native per-currency subtotals: nothing was converted, so nothing is stale.
    body: {
      positions: positionsDTO,
      subtotalsByCurrency,
      fxIncomplete: false,
      basisMismatches: basisFindings,
      unverifiedSplits: splitBasis.unverified,
      fxStale: false,
      fxRatesAsOf: null,
    },
    targetCurrency,
    todayChange,
    totalReturn,
  };
}
