import { eq, and, desc, inArray } from "drizzle-orm";
import {
  Decimal,
  computeRetroactiveIncome,
  buildReceivedDividends,
  projectDividendSchedule,
  projectionHorizonIso,
  computeDividendCAGR,
  classifyDividendTrend,
  dedupeDividends,
  incomePaymentDates,
  excludeMatchedInFlight,
  type DividendHistoryRow,
  type DividendTrend,
  type ProjectedDividendRow,
  type IncomeFrequencyUnit,
} from "@sage/core";
import type { IMarketDataProvider } from "@sage/provider-interface";
import type { Database } from "../db/client";
import {
  dividendHistory,
  instrument,
  assetProfile,
  user,
  customHolding,
  customIncome,
  portfolio,
} from "../db/schema";
import { triggerStaleDividendSync } from "../market-data/stale-sync";
import { loadPortfolioBook, type PortfolioBook } from "./portfolio-book";
import { resolvePricePoints } from "../market-data/manual-price-provider";
import { getRatesWithProvenance } from "../market-data/fx-provenance";
import type { PortfolioViewDeps } from "./portfolio-view";

// Extends the shared deps shape with the optional multi-provider dividend
// fallback list the route factory accepts today (`dividendProviders ??
// [provider]`), so this extraction doesn't silently drop production's
// multi-provider dividend sync behavior.
export interface DividendIncomeViewDeps extends PortfolioViewDeps {
  dividendProviders?: IMarketDataProvider[];
}

export interface DividendPerHoldingDTO {
  symbol: string;
  forwardAnnualIncome: { amount: string; currency: string };
  incomeShare: number;
  cagr5y: string | null;
  trend: DividendTrend;
}

export interface IncomeGroupRow {
  label: string;
  amount: { amount: string; currency: string };
  share: number;
}

/**
 * Per-symbol forward annual income, already FX converted to the display
 * currency. Single source of truth shared by `buildPerHolding` and
 * `buildIncomeByGroup` so their share/amount figures cannot diverge.
 *
 * Forward income is three things: `projected` (future ex-dates we've modelled),
 * `announced` (future ex-dates already declared by the issuer), and `inFlight`
 * — dividends whose ex-date has *passed* but whose payment date is still ahead.
 * That last bucket is the most certain forward income there is; it's excluded
 * from the trailing/received totals (the cash hasn't landed), so it must be
 * counted here or it falls through the cracks and the forward hero/donut won't
 * reconcile with the "Next 12 months" chart that already surfaces it.
 */
function buildForwardBySymbol(
  announced: { symbol: string; income: string }[],
  projected: { symbol: string; income: string }[],
  inFlight: { symbol: string; income: string }[] = [],
): Map<string, Decimal> {
  const forwardBySymbol = new Map<string, Decimal>();
  for (const r of [...announced, ...projected, ...inFlight]) {
    forwardBySymbol.set(
      r.symbol,
      (forwardBySymbol.get(r.symbol) ?? new Decimal(0)).plus(new Decimal(r.income)),
    );
  }
  return forwardBySymbol;
}

/**
 * Per-holding forward income, income share, and dividend growth. Reuses the
 * already-loaded, already-FX-converted schedule DTOs and dividend history — no
 * new DB or provider work. Includes a holding if it has any dividend history or
 * any forward income; pure non-payers are omitted.
 */
function buildPerHolding(
  symbols: string[],
  forwardBySymbol: Map<string, Decimal>,
  divHistory: DividendHistoryRow[],
  now: Date,
  displayCcy: string,
): DividendPerHoldingDTO[] {
  const historyBySymbol = new Map<string, DividendHistoryRow[]>();
  for (const d of divHistory) {
    const list = historyBySymbol.get(d.symbol) ?? [];
    list.push(d);
    historyBySymbol.set(d.symbol, list);
  }
  let grandTotal = new Decimal(0);
  for (const v of forwardBySymbol.values()) grandTotal = grandTotal.plus(v);

  const rows: DividendPerHoldingDTO[] = [];
  for (const symbol of symbols) {
    const hist = historyBySymbol.get(symbol) ?? [];
    const forward = forwardBySymbol.get(symbol) ?? new Decimal(0);
    if (hist.length === 0 && forward.isZero()) continue;
    const cagr = computeDividendCAGR(hist, 5, now);
    rows.push({
      symbol,
      forwardAnnualIncome: { amount: forward.toFixed(2), currency: displayCcy },
      incomeShare: grandTotal.isZero() ? 0 : forward.dividedBy(grandTotal).toNumber(),
      cagr5y: cagr?.toFixed(6) ?? null,
      trend: classifyDividendTrend(cagr),
    });
  }
  return rows;
}

/**
 * Sector label for the income donut. Funds/ETFs have no single sector (their
 * income is spread across many), so they're bucketed together rather than
 * dumped into "Unknown" — which, for an ETF-heavy book, would otherwise
 * dominate the breakdown. Stocks use their own sector; a stock with no profiled
 * sector is the only genuine "Unknown".
 */
export function fundAwareSector(assetType: string | undefined, sector: string | null): string {
  if (assetType === "etf" || assetType === "fund") return "Funds & ETFs";
  return sector ?? "Unknown";
}

/**
 * Groups the same shared forward-income map (see `buildForwardBySymbol`) by
 * holding name, sector, and native currency, for the analytics-view donut.
 * Because `holdings` is keyed off the same per-symbol forward figures used by
 * `buildPerHolding`, its shares are guaranteed to equal `perHolding.incomeShare`.
 */
function buildIncomeByGroup(
  symbols: string[],
  forwardBySymbol: Map<string, Decimal>,
  nameBySymbol: Map<string, string>,
  currencyBySymbol: Map<string, string>,
  sectorBySymbol: Map<string, string>,
  displayCcy: string,
): { holdings: IncomeGroupRow[]; sector: IncomeGroupRow[]; currency: IncomeGroupRow[] } {
  let total = new Decimal(0);
  for (const v of forwardBySymbol.values()) total = total.plus(v);

  const rows = (keyFn: (symbol: string) => string): IncomeGroupRow[] => {
    const m = new Map<string, Decimal>();
    for (const symbol of symbols) {
      const forward = forwardBySymbol.get(symbol) ?? new Decimal(0);
      const key = keyFn(symbol);
      m.set(key, (m.get(key) ?? new Decimal(0)).plus(forward));
    }
    return [...m.entries()]
      .map(([label, v]) => ({
        label,
        amount: { amount: v.toFixed(2), currency: displayCcy },
        share: total.isZero() ? 0 : v.dividedBy(total).toNumber(),
      }))
      .filter((r) => Number(r.amount.amount) > 0)
      .sort((a, b) => b.share - a.share);
  };

  return {
    holdings: rows((symbol) => nameBySymbol.get(symbol) ?? symbol),
    sector: rows((symbol) => sectorBySymbol.get(symbol) ?? "Unknown"),
    currency: rows((symbol) => currencyBySymbol.get(symbol) ?? displayCcy),
  };
}

/**
 * Project a custom holding's future income directly from its stored payment
 * schedule (spec 2026-07-18 §3), shaped exactly like `projectDividendSchedule`
 * output so downstream FX conversion / DTO mapping doesn't need to
 * special-case it. Windows are the daily-accrual convention shared with
 * `syncCustomIncome`/`accrueGrossIncome`, simplified to a flat rate since the
 * position's share count and price are frozen at "now" (no known future buys
 * or price marks to accrue day-by-day against): for each future schedule date,
 * `income = shares × price × yearlyPct/100 × dayCount/365`, where `dayCount`
 * is the gap since the PRIOR schedule date (so an under-inferred multi-window
 * gap — e.g. after a missed sync — is still counted, not just one payment).
 * Skips the symbol entirely when it has no known price on or before today.
 */
async function buildCustomProjectedRows(
  db: Database,
  holding: typeof customHolding.$inferSelect,
  shares: Decimal,
  now: Date,
  todayIso: string,
): Promise<ProjectedDividendRow[]> {
  const horizon = new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const fullSchedule = incomePaymentDates({
    firstPaymentDate: holding.firstPaymentDate!,
    lastPaymentDate: holding.lastPaymentDate,
    unit: holding.frequencyUnit as IncomeFrequencyUnit,
    interval: holding.frequencyInterval,
    until: horizon,
  });

  const points = await resolvePricePoints(db, holding.symbol);
  const priced = points.filter((pt) => pt.date <= todayIso);
  if (priced.length === 0) return []; // unpriceable — nothing to project
  const latest = priced[priced.length - 1]!;
  const yearlyPct = new Decimal(holding.incomeYearlyPct!);

  const rows: ProjectedDividendRow[] = [];
  for (let i = 0; i < fullSchedule.length; i++) {
    const exDate = fullSchedule[i]!;
    if (exDate <= todayIso) continue;
    const prevDate = i > 0 ? fullSchedule[i - 1]! : holding.firstPaymentDate!;
    const dayCount =
      (new Date(`${exDate}T00:00:00Z`).getTime() - new Date(`${prevDate}T00:00:00Z`).getTime()) /
      86_400_000;
    if (dayCount <= 0) continue;
    const income = shares
      .times(latest.price)
      .times(yearlyPct)
      .dividedBy(100)
      .times(dayCount)
      .dividedBy(365);
    if (income.lessThanOrEqualTo(0)) continue;
    rows.push({
      symbol: holding.symbol,
      kind: "projected",
      confidence: "high",
      exDate,
      paymentDate: exDate,
      paymentDateEstimated: false,
      amountPerShare: income.dividedBy(shares).toFixed(),
      shares: shares.toFixed(),
      income: income.toFixed(2),
      currency: latest.currency,
    });
  }
  return rows;
}

export async function buildDividendIncomeView(
  deps: DividendIncomeViewDeps,
  userId: string,
  opts: { currency?: string | null; book?: PortfolioBook },
) {
  const { db, provider, fxRateService, dividendProviders } = deps;
  const book =
    opts.book ?? (await loadPortfolioBook(db, userId, { currency: opts.currency ?? null }));
  const { portfolioId, txs, positions, rows: ledgerRows } = book;
  let targetCurrency = book.targetCurrency;

  // Tax / growth settings — separate from the ledger snapshot.
  const [userRow] = await db
    .select({
      displayCurrency: user.displayCurrency,
      dividendTaxRate: user.dividendTaxRate,
      allowNegativeDividendGrowth: user.allowNegativeDividendGrowth,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!targetCurrency) {
    targetCurrency = userRow?.displayCurrency ?? null;
  }
  // numeric(5,2) round-trips through postgres.js as a string.
  const dividendTaxRate = userRow?.dividendTaxRate == null ? null : Number(userRow.dividendTaxRate);
  const allowNegativeDividendGrowth = userRow?.allowNegativeDividendGrowth ?? true;

  const symbols = positions.map((p) => p.symbol);

  // Self-healing coverage: refresh the stalest few symbols in the background.
  void triggerStaleDividendSync(db, dividendProviders ?? [provider], symbols).catch((err) => {
    console.warn("stale dividend sync failed:", err instanceof Error ? err.message : err);
  });

  // NOTE: no early return for `symbols.length === 0` — a fully-liquidated
  // portfolio (every holding sold) still has ledger dividend history that
  // must survive (the same class of bug this file exists to fix). Every
  // query below that's scoped to `symbols`/`positions` degrades gracefully
  // to empty results in that case (drizzle's `inArray` with `[]` compiles to
  // `false`, and `.map`/`.flatMap` over an empty `positions` yields `[]`),
  // while `receivedDTO` below is built from the ledger directly and is
  // unaffected.

  // Received rows can reference holdings no longer in `positions`, so names
  // must cover every symbol in the ledger too — otherwise a sold holding
  // renders as a raw ticker. Forward-looking lookups below stay scoped to
  // current positions on purpose: an exited holding projects nothing.
  const nameSymbols = [...new Set([...symbols, ...ledgerRows.map((t) => t.instrumentSymbol)])];
  const instruments =
    nameSymbols.length > 0
      ? await db.select().from(instrument).where(inArray(instrument.symbol, nameSymbols))
      : [];
  const nameBySymbol = new Map(instruments.map((i) => [i.symbol, i.name]));
  const currencyBySymbol = new Map(positions.map((p) => [p.symbol, p.currency]));

  const profileRows = await db
    .select()
    .from(assetProfile)
    .where(inArray(assetProfile.symbol, symbols));
  // Classify by the PROVIDER-detected asset type (asset_profile), not
  // instrument.assetType — the Snowball importer hard-codes every instrument to
  // "stock", so ETFs are only distinguishable via their fetched profile.
  const profileBySymbol = new Map(profileRows.map((p) => [p.symbol, p]));
  const sectorBySymbol = new Map(
    symbols.map((sym) => {
      const prof = profileBySymbol.get(sym);
      return [sym, fundAwareSector(prof?.assetType, prof?.sector ?? null)];
    }),
  );

  const dividendRows = await db
    .select()
    .from(dividendHistory)
    .where(inArray(dividendHistory.symbol, symbols))
    .orderBy(desc(dividendHistory.exDate));

  // Collapse the same payment reported by multiple providers a few days apart.
  const divHistory: DividendHistoryRow[] = dedupeDividends(
    dividendRows.map((d) => ({
      symbol: d.symbol,
      exDate: d.exDate,
      amountPerShare: d.amountPerShare,
      currency: d.currency,
      paymentDate: d.paymentDate,
      paymentDateEstimated: d.paymentDateEstimated,
      recordDate: d.recordDate,
      declarationDate: d.declarationDate,
      period: d.period,
    })),
  );

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const trailingCutoffIso = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const pastRows = divHistory.filter((d) => d.exDate <= todayIso);
  // Ex-dated in the future: not yet earned, so excluded from retroactive/projected
  // math. Task 12 surfaces these as upcoming/expected payments.
  const futureRows = divHistory.filter((d) => d.exDate > todayIso);
  // Synthetic by design: retroactive income is provider dividend history ×
  // shares held, NOT a sum of dividend `transaction` rows (including
  // reconciliation's source='auto' ones) — those feed the performance view's
  // cash flows only. Summing both here would double-count every payment.
  const retroactive = computeRetroactiveIncome(txs, pastRows);

  // v2 projection: announced provider rows come first, then a frequency-aware
  // model schedule that steps from the last known ex-date and skips any date
  // colliding with an announced one — so nothing is double counted.
  const futureBySymbol = new Map<string, typeof futureRows>();
  for (const d of futureRows) {
    const list = futureBySymbol.get(d.symbol) ?? [];
    list.push(d);
    futureBySymbol.set(d.symbol, list);
  }
  // Custom holdings carry an exact payment schedule in their settings — a
  // single engine payment can't be frequency-inferred, so history-based
  // projection would silently under-count them (Snowball parity gap: a
  // holding with one historical payment projected only that payment's amount
  // forward instead of its full quarterly/monthly/etc. cadence). Symbols with
  // usable income settings are projected directly from the schedule below and
  // excluded from the history-based `projectDividendSchedule` call entirely;
  // their dividend_history rows still feed retroactive/trailing sums
  // untouched, and custom holdings WITHOUT income settings keep current
  // (history-inferred) behavior.
  const customHoldingRows = await db
    .select()
    .from(customHolding)
    .where(and(eq(customHolding.portfolioId, portfolioId), eq(customHolding.incomeEnabled, true)));
  const customBySymbol = new Map(
    customHoldingRows
      .filter(
        (h) =>
          h.incomeYearlyPct !== null &&
          h.frequencyUnit !== null &&
          h.firstPaymentDate !== null &&
          Number.isInteger(h.frequencyInterval) &&
          h.frequencyInterval >= 1,
      )
      .map((h) => [h.symbol, h]),
  );

  const customScheduleRows: ProjectedDividendRow[] = [];
  for (const p of positions) {
    const holding = customBySymbol.get(p.symbol);
    if (!holding || !p.quantity.greaterThan(0)) continue;
    try {
      customScheduleRows.push(
        ...(await buildCustomProjectedRows(db, holding, p.quantity, now, todayIso)),
      );
    } catch (err) {
      // Bad stored settings must not break the whole view.
      console.warn(
        `custom income projection failed for ${p.symbol}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const scheduleRows = positions
    .filter((p) => !customBySymbol.has(p.symbol))
    .flatMap((p) =>
      projectDividendSchedule({
        symbol: p.symbol,
        quantity: p.quantity,
        history: pastRows.filter((d) => d.symbol === p.symbol),
        announced: (futureBySymbol.get(p.symbol) ?? []).map((d) => ({
          exDate: d.exDate,
          paymentDate: d.paymentDate ?? null,
          paymentDateEstimated: d.paymentDateEstimated ?? false,
          amountPerShare: d.amountPerShare,
          currency: d.currency,
        })),
        asOf: now,
      }),
    )
    .concat(customScheduleRows);
  const announcedScheduleRows = scheduleRows.filter((r) => r.kind === "announced");
  const projectedScheduleRows = scheduleRows.filter((r) => r.kind === "projected");

  // FX conversion. `retroactive`/`scheduleRows` are both scoped to CURRENT
  // positions, so a holding sold out entirely in a currency no longer held by
  // anything else would otherwise get no rate — and `convertAmount` below
  // returns such amounts unconverted, which then get silently dropped by every
  // `inDisplay` aggregation downstream. Ledger dividend currencies are derived
  // straight from `ledgerRows` (not `receivedDTO`, which is built after this
  // block using `convertAmount`) so a sold-out foreign-currency payer still
  // gets a rate.
  const ledgerDividendCurrencies = ledgerRows
    .filter((t) => t.type === "dividend" && t.tradeDate <= todayIso)
    .map((t) => t.currency);

  // Reinvested custom-income payments (holding.reinvest === true in
  // custom-income-sync) are credited to the ledger as a price-0 `buy` — cost
  // basis must stay untouched, so the transaction row itself carries no
  // recoverable dollar amount — with the actual GROSS income fact recorded
  // only in the paired `dividend_history` row (`source: "custom"`, same
  // symbol + date) that custom-income-sync also writes. buildReceivedDividends
  // only recognizes `type: "dividend"` ledger rows, so it structurally cannot
  // see these payments, and they must NOT be reconstructed the normal
  // synthetic way either — that path is discarded once past-dated by design
  // (the ledger owns history). So they're rebuilt here specifically: GROSS =
  // amountPerShare x shares held on the payment date, using the FULL ledger
  // timeline (`txs`, unscoped by current positions) so a since-sold-out
  // custom holding's history survives too, exactly like the ledger-based
  // reconstruction above.
  //
  // Bounded to REINVESTING custom holdings only (via `customHolding.reinvest`)
  // — a non-reinvest custom holding's cash dividend already lands as a real
  // ledger `dividend` transaction, read directly via `buildReceivedDividends`
  // below; treating its `dividend_history` row as fair game here too would
  // silently resurrect a payment the user deliberately deleted. `custom_income`
  // persists as a tombstone (`transactionId = null`) when its ledger
  // transaction is deleted (see db/schema/custom-holding.ts), but the paired
  // `dividend_history` row is untouched by that delete — so tombstoned
  // (symbol, payDate) pairs are excluded below too. That also covers a
  // REINVEST holding's own deleted payment: its ledger row is a `buy`, not a
  // `dividend`, so the `dividendTxDates` exclusion further below never catches
  // it on its own.
  //
  // Computed here — ahead of the FX-rate lookup below, not after it — so a
  // fully-sold reinvesting holding in a currency no other holding uses still
  // gets a rate. Without this, `convertAmount` returns such amounts
  // unconverted and every `inDisplay` aggregation downstream silently drops
  // them; the same class of bug `ledgerDividendCurrencies` above exists to fix
  // for the plain ledger path.
  const reinvestCustomHoldingRows =
    nameSymbols.length > 0
      ? await db
          .select({ symbol: customHolding.symbol })
          .from(customHolding)
          .where(and(eq(customHolding.portfolioId, portfolioId), eq(customHolding.reinvest, true)))
      : [];
  const reinvestSymbols = new Set(reinvestCustomHoldingRows.map((h) => h.symbol));

  const customDividendHistoryRows =
    reinvestSymbols.size > 0
      ? await db
          .select()
          .from(dividendHistory)
          .where(
            and(
              inArray(dividendHistory.symbol, [...reinvestSymbols]),
              eq(dividendHistory.source, "custom"),
            ),
          )
      : [];

  const customIncomeRows =
    reinvestSymbols.size > 0
      ? await db
          .select({
            symbol: customIncome.symbol,
            payDate: customIncome.payDate,
            transactionId: customIncome.transactionId,
          })
          .from(customIncome)
          .where(
            and(
              eq(customIncome.portfolioId, portfolioId),
              inArray(customIncome.symbol, [...reinvestSymbols]),
            ),
          )
      : [];
  const tombstonedPaymentDates = new Set(
    customIncomeRows.filter((r) => r.transactionId === null).map((r) => `${r.symbol}|${r.payDate}`),
  );

  // Excluded below: any `source: custom` history row that already has a
  // matching ledger `dividend` transaction — the non-reinvest case, whose row
  // is already gross and read directly from the ledger — so nothing here is
  // ever double counted. Redundant with the `reinvest`-only bound above for a
  // holding whose flag has never changed (reinvest holdings never write
  // `dividend`-type rows), but kept as a second guard in case `reinvest` is
  // toggled after history already exists under the other convention.
  const dividendTxDates = new Set(
    ledgerRows
      .filter((t) => t.type === "dividend")
      .map((t) => `${t.instrumentSymbol}|${t.tradeDate}`),
  );
  const reinvestDividendHistory: DividendHistoryRow[] = customDividendHistoryRows
    .filter((d) => !dividendTxDates.has(`${d.symbol}|${d.exDate}`))
    .filter((d) => !tombstonedPaymentDates.has(`${d.symbol}|${d.exDate}`))
    .map((d) => ({
      symbol: d.symbol,
      exDate: d.exDate,
      amountPerShare: d.amountPerShare,
      currency: d.currency,
      paymentDate: d.paymentDate,
      paymentDateEstimated: d.paymentDateEstimated,
    }));
  const reinvestReceived = computeRetroactiveIncome(txs, reinvestDividendHistory)
    .filter((r) => (r.paymentDate ?? r.exDate) <= todayIso)
    .map((r) => ({
      symbol: r.symbol,
      cashDate: r.paymentDate ?? r.exDate,
      income: r.income,
      currency: r.currency,
      amountPerShare: r.amountPerShare,
      sharesHeld: r.sharesHeld,
    }));

  const fxRates = new Map<string, Decimal>();
  let fxStale = false;
  let fxRatesAsOf: string | null = null;
  if (targetCurrency && fxRateService) {
    const allCurrencies = new Set([
      ...retroactive.map((r) => r.currency),
      ...scheduleRows.map((r) => r.currency),
      ...ledgerDividendCurrencies,
      ...reinvestReceived.map((r) => r.currency),
    ]);
    const toConvert = [...allCurrencies].filter((c) => c !== targetCurrency);
    if (toConvert.length > 0) {
      try {
        const { rates, stale, asOf } = await getRatesWithProvenance(
          fxRateService,
          targetCurrency,
          toConvert,
        );
        for (const [ccy, rate] of rates) fxRates.set(ccy, rate);
        fxStale = stale;
        fxRatesAsOf = asOf;
      } catch {
        // FX unavailable — fall through without conversion
      }
    }
  }

  function convertAmount(
    amount: string,
    fromCurrency: string,
  ): { amount: string; currency: string } {
    if (!targetCurrency || fromCurrency === targetCurrency || !fxRates.has(fromCurrency)) {
      return { amount, currency: fromCurrency };
    }
    const rate = fxRates.get(fromCurrency)!;
    const converted = new Decimal(amount).dividedBy(rate);
    return { amount: converted.toFixed(2), currency: targetCurrency };
  }

  const syntheticRetroactiveDTO = retroactive.map((r) => {
    const conv = convertAmount(r.income, r.currency);
    return {
      ...r,
      income: conv.amount,
      currency: conv.currency,
      amountPerShare: convertAmount(r.amountPerShare, r.currency).amount,
      name: nameBySymbol.get(r.symbol) ?? r.symbol,
    };
  });
  const projectedDTO = projectedScheduleRows.map((r) => {
    const conv = convertAmount(r.income, r.currency);
    return {
      symbol: r.symbol,
      name: nameBySymbol.get(r.symbol) ?? r.symbol,
      projectedExDate: r.exDate,
      paymentDate: r.paymentDate,
      paymentDateEstimated: r.paymentDateEstimated,
      confidence: r.confidence,
      amountPerShare: convertAmount(r.amountPerShare, r.currency).amount,
      shares: r.shares,
      income: conv.amount,
      currency: conv.currency,
    };
  });
  const announcedDTO = announcedScheduleRows.map((r) => {
    // Re-attach provider metadata (name, declaration/record dates) that the
    // core schedule row does not carry, matching the futureRows entry by
    // symbol + ex-date.
    const meta = (futureBySymbol.get(r.symbol) ?? []).find((d) => d.exDate === r.exDate);
    const conv = convertAmount(r.income, r.currency);
    return {
      symbol: r.symbol,
      name: nameBySymbol.get(r.symbol) ?? r.symbol,
      declarationDate: meta?.declarationDate ?? null,
      exDate: r.exDate,
      recordDate: meta?.recordDate ?? null,
      paymentDate: r.paymentDate,
      paymentDateEstimated: r.paymentDateEstimated,
      amountPerShare: convertAmount(r.amountPerShare, r.currency).amount,
      shares: r.shares,
      income: conv.amount,
      currency: conv.currency,
    };
  });

  // HISTORY comes from the ledger — what actually landed, including payments
  // from holdings since fully sold, which the synthetic reconstruction below
  // structurally cannot see (its symbol list is today's positions). Reinvested
  // custom-income payments (no ledger `dividend` row — see above) are folded
  // in from `reinvestReceived`.
  const receivedDTO = [
    ...buildReceivedDividends(
      ledgerRows.map((t) => ({
        symbol: t.instrumentSymbol,
        type: t.type,
        quantity: t.quantity,
        price: t.price,
        currency: t.currency,
        tradeDate: t.tradeDate,
        source: t.source ?? null,
      })),
      todayIso,
    ),
    ...reinvestReceived,
  ]
    .sort((a, b) => a.cashDate.localeCompare(b.cashDate) || a.symbol.localeCompare(b.symbol))
    .map((r) => {
      const conv = convertAmount(r.income, r.currency);
      return {
        symbol: r.symbol,
        name: nameBySymbol.get(r.symbol) ?? r.symbol,
        exDate: r.cashDate,
        paymentDate: r.cashDate,
        paymentDateEstimated: false,
        amountPerShare:
          r.amountPerShare == null ? null : convertAmount(r.amountPerShare, r.currency).amount,
        sharesHeld: r.sharesHeld,
        income: conv.amount,
        currency: conv.currency,
      };
    });

  // The synthetic reconstruction survives ONLY for cash that has not landed:
  // an ex-date that has passed with a payment still pending has no ledger row.
  // Its past-dated rows are deliberately discarded — the ledger owns those, and
  // keeping both would double-count every payment. Beyond that, a synthetic
  // row can still pair with a received ledger row dated a few days apart (the
  // ledger's cash date vs. the provider's payment date disagreeing) — excluded
  // via the same ±10-day matcher `planAutoDividends` uses, so that cash is
  // never counted as both history and forward income.
  const inFlightDTO = excludeMatchedInFlight(
    syntheticRetroactiveDTO.filter((r) => (r.paymentDate ?? r.exDate) > todayIso),
    receivedDTO.map((r) => ({ symbol: r.symbol, cashDate: r.exDate })),
  );

  const retroactiveDTO = [...receivedDTO, ...inFlightDTO];

  // Prefer the user's display currency when set; otherwise a single native
  // currency if the book is homogeneous. Portfolio-level sums only include
  // rows that actually land in that currency (converted or native) — never
  // add EUR face value into a USD total.
  //
  // The last resort used to be the literal "USD". On a fresh install with no
  // dividend history yet every source above is empty, so the summary was built
  // as `{ amount: "0", currency: "USD" }` and the analytics headline read
  // `ANNUAL INCOME $0` — a currency the user never chose, on a number that did
  // not exist. Falling back to the book's own currency covers the ordinary
  // single-currency install; a mixed book with no display currency yields null,
  // and the summary below is then omitted rather than invented.
  const bookCurrencies = new Set(positions.map((p) => p.currency));
  const displayCcy: string | null =
    targetCurrency ??
    retroactiveDTO[0]?.currency ??
    projectedDTO[0]?.currency ??
    announcedDTO[0]?.currency ??
    (bookCurrencies.size === 1 ? [...bookCurrencies][0]! : null);
  const inDisplay = (ccy: string) => ccy === displayCcy;
  /** A portfolio-level total, or nothing when we cannot name its currency. */
  const money = (total: Decimal) =>
    displayCcy === null ? [] : [{ amount: total.toFixed(), currency: displayCcy }];

  // A received row we could not convert is excluded from every total by
  // `inDisplay`. That exclusion is correct — mixing currencies in one sum is
  // dishonest — but it must not be silent, or history quietly understates.
  const fxIncomplete = receivedDTO.some((r) => !inDisplay(r.currency));

  // No recorded dividends AND the setting that would record them is actually
  // off: say so. An empty `receivedDTO` alone is not evidence of that — a
  // freshly bought dividend payer (autoAddDividends true, first payment still
  // weeks away) looks identical in shape (empty received, non-empty provider
  // history) but recording is working as intended, so the message must check
  // the real setting rather than infer it from data shape (see
  // dividend-reconciliation.ts for the same access pattern).
  const [pf] = await db
    .select({ auto: portfolio.autoAddDividends })
    .from(portfolio)
    .where(eq(portfolio.id, portfolioId));
  const incomeRecordingOff = !pf?.auto && receivedDTO.length === 0 && divHistory.length > 0;

  let totalRetro = new Decimal(0);
  let totalProj = new Decimal(0);
  for (const r of retroactiveDTO) {
    // trailingTwelveMonthIncome must reflect the trailing 12 months of CASH
    // received, not all-time history — so only count payments landing in
    // (now - 365 days, today]. Future-dated payments (declared-but-unpaid)
    // are excluded here: that cash hasn't been received yet (it's in-flight).
    if (!inDisplay(r.currency)) continue;
    const cashDate = r.paymentDate ?? r.exDate;
    if (cashDate > trailingCutoffIso && cashDate <= todayIso) {
      totalRetro = totalRetro.plus(new Decimal(r.income));
    }
  }
  for (const r of projectedDTO) {
    if (!inDisplay(r.currency)) continue;
    totalProj = totalProj.plus(new Decimal(r.income));
  }
  for (const a of announcedDTO) {
    if (!inDisplay(a.currency)) continue;
    totalProj = totalProj.plus(new Decimal(a.income));
  }
  for (const r of inFlightDTO) {
    if (!inDisplay(r.currency)) continue;
    totalProj = totalProj.plus(new Decimal(r.income));
  }

  // Monthly breakdown — only rows in displayCcy so month totals are honest
  const monthMap = new Map<
    string,
    { retroactive: Decimal; announced: Decimal; projected: Decimal }
  >();
  for (const r of retroactiveDTO) {
    if (!inDisplay(r.currency)) continue;
    const cashDate = r.paymentDate ?? r.exDate;
    const month = cashDate.slice(0, 7);
    const entry = monthMap.get(month) ?? {
      retroactive: new Decimal(0),
      announced: new Decimal(0),
      projected: new Decimal(0),
    };
    // The ex-date has passed, but if the payment date is still in the future the
    // cash hasn't actually been received — it's a confirmed *upcoming* payment,
    // not "paid". Counting it as paid makes a future month (e.g. next month)
    // show income as already received, which is impossible.
    if (cashDate <= todayIso) {
      entry.retroactive = entry.retroactive.plus(new Decimal(r.income));
    } else {
      entry.announced = entry.announced.plus(new Decimal(r.income));
    }
    monthMap.set(month, entry);
  }
  for (const r of projectedDTO) {
    if (!inDisplay(r.currency)) continue;
    const month = (r.paymentDate ?? r.projectedExDate).slice(0, 7);
    const entry = monthMap.get(month) ?? {
      retroactive: new Decimal(0),
      announced: new Decimal(0),
      projected: new Decimal(0),
    };
    entry.projected = entry.projected.plus(new Decimal(r.income));
    monthMap.set(month, entry);
  }
  for (const a of announcedDTO) {
    if (!inDisplay(a.currency)) continue;
    const month = (a.paymentDate ?? a.exDate).slice(0, 7);
    const entry = monthMap.get(month) ?? {
      retroactive: new Decimal(0),
      announced: new Decimal(0),
      projected: new Decimal(0),
    };
    entry.announced = entry.announced.plus(new Decimal(a.income));
    monthMap.set(month, entry);
  }
  // `monthMap` is filled only from rows passing `inDisplay`, which matches
  // nothing when there is no display currency — so this is already empty in
  // that case. Saying so explicitly keeps the row's `currency` a string
  // instead of widening the DTO to carry a null nobody downstream expects.
  const monthlyBreakdown =
    displayCcy === null
      ? []
      : [...monthMap.entries()]
          .map(([month, val]) => ({
            month,
            retroactive: val.retroactive.toFixed(),
            announced: val.announced.toFixed(),
            projected: val.projected.toFixed(),
            currency: displayCcy,
          }))
          .sort((a, b) => a.month.localeCompare(b.month));

  // Only display-currency rows enter the forward map. convertAmount leaves
  // unconvertible rows in their native currency; summing those into a map that
  // buildPerHolding then labels as displayCcy would silently mix FX units.
  const forwardBySymbol = buildForwardBySymbol(
    announcedDTO.filter((r) => inDisplay(r.currency)),
    projectedDTO.filter((r) => inDisplay(r.currency)),
    inFlightDTO.filter((r) => inDisplay(r.currency)),
  );

  // Same reasoning as monthlyBreakdown below: `forwardBySymbol` is built from
  // `inDisplay` rows only, so both of these are empty when the currency is
  // unknown. Every figure they carry is money, and money needs a unit.
  const perHolding =
    displayCcy === null
      ? []
      : buildPerHolding(symbols, forwardBySymbol, divHistory, now, displayCcy);

  const incomeByGroup =
    displayCcy === null
      ? { holdings: [], sector: [], currency: [] }
      : buildIncomeByGroup(
          symbols,
          forwardBySymbol,
          nameBySymbol,
          currencyBySymbol,
          sectorBySymbol,
          displayCcy,
        );

  const yearMap = new Map<string, Decimal>();
  for (const r of retroactiveDTO) {
    if (!inDisplay(r.currency)) continue;
    const cashDate = r.paymentDate ?? r.exDate;
    if (cashDate > todayIso) continue;
    const year = cashDate.slice(0, 4);
    yearMap.set(year, (yearMap.get(year) ?? new Decimal(0)).plus(new Decimal(r.income)));
  }
  const receivedByYear =
    displayCcy === null
      ? []
      : [...yearMap.entries()]
          .map(([year, amt]) => ({ year, amount: amt.toFixed(2), currency: displayCcy }))
          .sort((a, b) => a.year.localeCompare(b.year));

  return {
    retroactive: retroactiveDTO,
    announced: announcedDTO,
    projected: projectedDTO,
    perHolding,
    incomeByGroup,
    dividendTaxRate,
    fxIncomplete,
    fxStale,
    fxRatesAsOf,
    incomeRecordingOff,
    allowNegativeDividendGrowth,
    /** The last date any projection here reaches. The clients need to be able
     *  to *name* it: the dividends year picker offers next year in full, so its
     *  months past this date render empty, and an empty December has to read as
     *  "past the forecast" rather than "nothing expected". Sent from the server
     *  because the server owns the rule — a `+ 1 year` reimplemented in the web
     *  app would drift the moment the horizon moved, and `apps/web` deliberately
     *  does not depend on `@sage/core`, where that rule lives. */
    projectedThrough: projectionHorizonIso(now),
    summary: {
      // Empty when there is no currency to state the total in, which the
      // clients already render as "—". A figure needs a unit; `0` on its own is
      // not a smaller truth than "we don't know", it is a different claim.
      trailingTwelveMonthIncome: money(totalRetro),
      projectedTwelveMonthIncome: money(totalProj),
      monthlyBreakdown,
      receivedByYear,
    },
  };
}
