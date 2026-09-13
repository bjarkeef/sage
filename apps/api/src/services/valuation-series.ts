import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { instrument } from "../db/schema";
import {
  Decimal,
  replayHoldings,
  replayConvertedInvested,
  resolveSplitBasis,
  type CurrencyCode,
  type HoldingsTimeline,
  type SplitBasisResolution,
} from "@sage/core";
import { findBasisMismatches } from "./basis-reconciliation";
import type {
  FxSeries,
  HistoryOptions,
  IHistoricalFxRateService,
  IMarketDataProvider,
  PriceBar,
} from "@sage/provider-interface";
import type { PortfolioViewDeps } from "./portfolio-view";
import { loadPortfolioBook, type PortfolioBook, type TransactionRow } from "./portfolio-book";
import { getRatesWithProvenance } from "../market-data/fx-provenance";
import { mapBounded } from "./bounded-map";

export const rangeSchema = z.enum(["1W", "1M", "3M", "YTD", "1Y", "ALL"]).default("1Y");

/** Repair fetches in flight at once. Same value as `REFRESH_BUDGET` in
 *  `persisted-price-provider.ts` and the same reasoning -- a fifty-symbol book
 *  must not open fifty upstream connections -- but deliberately a SEPARATE
 *  limit, not a shared counter: a fetch a user is waiting on must not be
 *  starved by background refreshes nobody is waiting on. */
const REPAIR_CONCURRENCY = 5;

/** How long a repair may spend starting upstream fetches. There is no timeout
 *  anywhere on this path -- the web client passes no AbortSignal and
 *  @hono/node-server inherits Node's five-minute requestTimeout -- so without
 *  this a slow upstream hangs the page instead of failing it. Symbols left
 *  unfetched stay in `historyIncomplete`, which is what the flag is for. */
const REPAIR_BUDGET_MS = 20_000;

export type { TransactionRow };

/** How far past a date the first bar may fall before it counts as missing
 *  history rather than a market that was simply shut.
 *
 *  A tolerance is unavoidable: window starts are calendar dates and bars are
 *  trading days, so a range opening over a weekend or a holiday legitimately
 *  has no bar for a day or three — for every symbol at once. Four days covers a
 *  Friday-to-Monday plus a holiday either side: long enough that no normal
 *  closure trips it, short enough that a real gap of weeks always does.
 *
 *  Shared with the benchmark comparison in `performance-view`, which needs the
 *  same allowance when lining an index up against the portfolio's own window. */
export const CLOSED_MARKET_TOLERANCE_DAYS = 4;

/**
 * How long a close may be carried forward before the series says so.
 *
 * Forward-fill is how a holding survives a weekend, a holiday, or a day its
 * exchange simply did not print. It was unbounded: a symbol whose bars stopped
 * in August was still "priceable" in September at August's price, and nothing
 * anywhere said so. On the reporting book 18 of 27 holdings had no bar for three
 * weeks and the chart drew a confident line through all of it.
 *
 * The fix is to DISCLOSE, not to drop. Dropping the holding would take its value
 * out of the total and draw a cliff — the book would appear to have lost money
 * it still has, which is a worse lie than a stale price. A stale price is the
 * best estimate available; the defect was only ever the silence.
 *
 * 10 days clears a long weekend plus a public holiday either side of it with
 * room to spare, and is short enough that a stalled refresher is caught within
 * a fortnight.
 */
export const STALE_PRICE_DAYS = 10;

/** One date's conversion factor, and whether it had to be approximated. */
export interface FxConversion {
  /** Units of the source currency per 1 target unit — DIVIDE a native amount
   *  by this. */
  divisor: Decimal;
  /** True when this came from today's spot rate because the historical series
   *  could not price that date. */
  approximated: boolean;
}

/**
 * Fallback-aware per-date FX lookup for one valuation series.
 *
 * Deliberately NOT an {@link FxSeries}: that published contract says `rateOn`
 * returns null when a date cannot be priced and that `coversFrom` is the
 * earliest date the series can price. This one keeps pricing dates before its
 * historical coverage — from today's spot rate — so a consumer gating on
 * `coversFrom` would get no protection at all. Every such date is instead
 * admitted in {@link FxConversion.approximated}, which callers must propagate
 * into whatever honesty flag they publish.
 */
export interface SeriesFxLookup {
  /** Conversion for `currency` on `date`; null when it cannot be priced at
   *  all, by either the historical series or spot. A caller that skips an
   *  amount on null must OR that into its own `fxIncomplete`. */
  rateOn(date: string, currency: CurrencyCode): FxConversion | null;
}

/** A portfolio valued day by day, already converted into `targetCurrency`. */
export interface ValuationSeries {
  targetCurrency: string;
  multiCurrency: boolean;
  range: z.infer<typeof rangeSchema>;
  clampedFrom: Date;
  to: Date;
  /** `invested` is cost basis — real money in, for the invested line and XIRR.
   *  `flowBasis` is the same series with each holding's arrival charged at
   *  market value instead, which is what daily returns must net against; see
   *  `ValuationPoint.flowBasis` in core. They differ only where a holding
   *  joined the series after the window opened. */
  points: { date: string; marketValue: Decimal; invested: Decimal; flowBasis: Decimal }[];
  /** Per-symbol verdict on whether stored price history is split-adjusted, and
   *  the multiplier applied to historical quantities. Published so the
   *  reporting layer suppresses exactly what was corrected, rather than forming
   *  a second opinion that could disagree. */
  splitBasis: SplitBasisResolution;
  timeline: HoldingsTimeline;
  /** Per-date conversion into `targetCurrency`, for consumers converting their
   *  own flows off the same book. */
  fxLookup: SeriesFxLookup;
  /** True when at least one conversion THIS build performed fell back to the
   *  spot rate. A consumer making further `fxLookup` calls must OR its own
   *  approximations into this before publishing it. */
  fxApproximated: boolean;
  /** True when at least one amount was DROPPED from the series because neither
   *  the historical series nor spot could price its currency — ECB publishes no
   *  INR, BRL or AED, so a holding in one of those is simply missing rather
   *  than wrong. Without this the chart would just get quietly smaller.
   *
   *  Same contract as {@link fxApproximated}: a consumer making further
   *  `fxLookup` calls must OR its own skips into this before publishing it. */
  fxIncomplete: boolean;
  /** True when the stored ECB series' newest publication day is past the
   *  staleness threshold — every conversion here is priced off a rate that old.
   *  False when nothing needed converting. */
  fxStale: boolean;
  /** Publication day the spot rates came from; null when nothing needed
   *  converting or nothing is stored. */
  fxRatesAsOf: string | null;
  /** Holdings whose earliest available bar falls after the first date in this
   *  window on which they were held, so part of the period cannot be valued.
   *  Empty on a complete book. Sorted, for a stable response. */
  historyIncomplete: string[];
  /** Holdings carried on a close older than {@link STALE_PRICE_DAYS}, with the
   *  date of the oldest such close. They ARE in the totals — at a price that may
   *  be weeks old — which is exactly why it has to be said out loud. Sorted. */
  stalePrices: { symbol: string; asOf: string }[];
  rows: TransactionRow[];
}

export type ValuationSeriesResult = ValuationSeries | { empty: true; targetCurrency: string };

/**
 * Calendar days of price history read BEFORE the window start, used only to
 * seed the forward-fill. No point is ever emitted for them.
 *
 * Without it the first day of a window could only value symbols holding a bar
 * on that exact calendar date, because `lastClose` had nothing to carry in
 * yet. Window starts are calendar dates and bars fall on trading days, so
 * "that exact date" is routinely a day nothing traded — YTD opens on 1 January
 * every year, 1W opens on whatever weekday today is, 3M lands on a weekend one
 * time in three. The point emitted then contained only the symbols that
 * happened to trade, and custom holdings, whose provider re-dates their last
 * mark to the window start so they never vanish from a chart.
 *
 * On a real book that produced a first point of 12,779 against a true 38,029 —
 * a GBP savings account and nothing else — which the money-weighted return
 * then took as the opening balance and reported 52% for the year against a
 * time-weighted 8.7%. The cost line disagreed with itself between ranges for
 * the same date for the same reason.
 *
 * 14 days clears the longest ordinary closure (Christmas into New Year,
 * Easter) with room to spare. The FX series has always been fetched from
 * inception on exactly this reasoning — see `fromKey` below, and the comment
 * there about the invested line disagreeing between ranges. Prices never were.
 */
const WARMUP_DAYS = 14;

/** Range start in UTC calendar days — trade/bar dates are UTC keys throughout. */
function rangeToDate(range: z.infer<typeof rangeSchema>): Date {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  switch (range) {
    case "1W":
      return new Date(Date.UTC(y, m, d - 7));
    case "1M":
      return new Date(Date.UTC(y, m - 1, d));
    case "3M":
      return new Date(Date.UTC(y, m - 3, d));
    case "YTD":
      return new Date(Date.UTC(y, 0, 1));
    case "1Y":
      return new Date(Date.UTC(y - 1, m, d));
    case "ALL":
      return new Date("1970-01-01T00:00:00Z");
  }
}

/**
 * Value a user's portfolio day by day over `range`, in `currency`.
 *
 * Every amount — bar closes and cost basis alike — is converted at the rate of
 * the date it belongs to: a close at the close's date, a flow at its trade
 * date. Dates the stored historical series cannot price fall back to the spot
 * rate and set {@link ValuationSeries.fxApproximated}; a currency neither can
 * price at all is dropped and sets {@link ValuationSeries.fxIncomplete}; rates
 * older than the staleness threshold set {@link ValuationSeries.fxStale}. All
 * three are for the caller to publish — the series never quietly shrinks.
 */
export async function buildValuationSeries(
  deps: PortfolioViewDeps,
  userId: string,
  opts: {
    range?: string;
    currency?: string | null;
    book?: PortfolioBook;
    repairHistory?: boolean;
  },
): Promise<ValuationSeriesResult> {
  const { db, provider, fxRateService } = deps;
  const range = rangeSchema.parse(opts.range);
  const from = rangeToDate(range);
  const to = new Date();

  const book =
    opts.book ?? (await loadPortfolioBook(db, userId, { currency: opts.currency ?? null }));
  const { rows, txs } = book;
  const currency = opts.currency ?? book.targetCurrency;

  const timeline = replayHoldings(txs);
  if (timeline.firstTransactionDate === null) {
    return { empty: true, targetCurrency: opts.currency ?? "USD" };
  }

  // One pass over transactions already in memory. `max(windowStart, firstTrade)`
  // is the first date in THIS window on which the symbol was held, which is the
  // earliest bar it needs; a holding bought mid-window legitimately has none
  // before that.
  const firstTradeBySymbol = new Map<string, string>();
  for (const t of txs) {
    const key = t.tradeDate.toISOString().slice(0, 10);
    const seen = firstTradeBySymbol.get(t.symbol);
    if (seen === undefined || key < seen) firstTradeBySymbol.set(t.symbol, key);
  }

  // Clamp the fetch window to the portfolio's actual inception: a wide range
  // (e.g. "ALL") should not walk decades of price history that predate every
  // position — quantities there are zero anyway, but there's no reason to
  // fetch or iterate them.
  const inceptionKey = timeline.firstTransactionDate;
  const inception = new Date(`${inceptionKey}T00:00:00Z`);
  const clampedFrom = from > inception ? from : inception;

  // Pick the target currency from the currently-HELD mix when the caller
  // doesn't pin one explicitly. Restrict to currencies of symbols still held:
  // cumulative net-invested keeps residue for fully-exited positions (a losing
  // exit leaves a positive remainder), which must not win this reduce.
  const todaySnap = timeline.asOf(to.toISOString().slice(0, 10));
  const heldCurrencies = new Set(
    timeline.symbols
      .filter((s) => {
        const qty = todaySnap.quantities.get(s);
        return qty !== undefined && qty.greaterThan(0);
      })
      .map((s) => timeline.currencyOf(s)),
  );
  const targetCurrency =
    currency ??
    [...todaySnap.invested]
      .filter(([ccy]) => heldCurrencies.has(ccy))
      .reduce(
        (best, [ccy, amount]) => (amount.greaterThan(best.val) ? { ccy, val: amount } : best),
        { ccy: "USD", val: new Decimal(0) },
      ).ccy;

  // Fetch bars for EVERY symbol. The provider quotes each bar in its own
  // currency (`bar.close.currency`, authoritative — Yahoo even pre-normalizes
  // GBp→GBP); that can differ from the currency the user PAID in, which is all
  // `timeline.currencyOf` records. Filtering by transaction currency here (as
  // an earlier version did) both dropped priceable symbols and, worse, later
  // converted a bar with the wrong currency's rate.
  //
  // Bounded, not `Promise.all`: a store read is free to run unbounded, but once
  // `repairHistory` can turn a read into an upstream fetch, a fifty-holding book
  // must not open fifty connections at once. Deadlined for the same reason —
  // this path has no other timeout, so a slow upstream would otherwise hang the
  // page instead of leaving the symbol in `historyIncomplete`.
  // Custom holdings price from manual marks that are MEANT to stand until
  // changed, so they can never be "stale" in the sense STALE_PRICE_DAYS means.
  // One indexed read over symbols already in hand.
  const customRows =
    timeline.symbols.length > 0
      ? await db
          .select({ symbol: instrument.symbol })
          .from(instrument)
          .where(
            and(
              inArray(instrument.symbol, [...timeline.symbols]),
              eq(instrument.assetType, "custom"),
            ),
          )
      : [];
  const customSymbols = new Set(customRows.map((r) => r.symbol));

  const windowStartKey = clampedFrom.toISOString().slice(0, 10);
  // Read from here, emit from `windowStartKey`. Passed as `seedFrom`, NOT as a
  // wider `from`: the store is not missing these two weeks, so widening `from`
  // would report every symbol short and fire a background refresh per symbol on
  // every chart load. See WARMUP_DAYS and `HistoryOptions.seedFrom`.
  const warmupFrom = new Date(clampedFrom.getTime() - WARMUP_DAYS * 86_400_000);
  const deadline = Date.now() + REPAIR_BUDGET_MS;
  const pricesBySymbol = new Map<string, PriceBar[]>();
  await mapBounded(timeline.symbols, REPAIR_CONCURRENCY, async (symbol) => {
    // Only a symbol whose ledger predates its bars can be repaired, and only a
    // caller that asked for it pays. Everything else takes the store-first path
    // exactly as before, which is why a complete book makes no upstream call.
    let historyOpts: HistoryOptions = { seedFrom: warmupFrom };
    if (opts.repairHistory) {
      const firstTrade = firstTradeBySymbol.get(symbol);
      if (firstTrade !== undefined) {
        const requiredKey = firstTrade > windowStartKey ? firstTrade : windowStartKey;
        // Only a position actually held inside the window can be reported
        // short, so only it is worth fetching for. A holding sold years before
        // the range opened still has a first trade, and without this a 1M chart
        // would block on an upstream fetch for it that no flag could ever
        // clear.
        const heldQty = timeline.asOf(requiredKey).quantities.get(symbol);
        if (heldQty !== undefined && heldQty.greaterThan(0)) {
          historyOpts = {
            ...historyOpts,
            requireFrom: new Date(`${requiredKey}T00:00:00Z`),
            deadline,
          };
        }
      }
    }
    try {
      pricesBySymbol.set(
        symbol,
        await provider.getHistoricalPrices(symbol, clampedFrom, to, historyOpts),
      );
    } catch {
      pricesBySymbol.set(symbol, []);
    }
  });

  // Detection is a comparison, not a query: the bars are already in hand and
  // `PriceStore.readBars` orders by date ascending, so `bars[0]` IS the
  // earliest. Custom holdings exclude themselves without a special case --
  // `ManualPriceProvider` seeds a bar at the window start so a mark predating
  // the window is not lost, which makes this comparison false for them.
  // `historyIncomplete` is computed inside the point loop below, from the
  // symbols found held-but-unpriceable on a date the series actually values —
  // plus the truncation arm after it, for the case where the series never got
  // to value that stretch at all.

  // Convert into the target currency at EACH DATE's own rate. The rate set must
  // cover BOTH what the user paid in (transaction currencies, for cost/flows)
  // and what bars are quoted in (bar currencies, for value).
  const currencyUnion = new Set<string>();
  for (const symbol of timeline.symbols) currencyUnion.add(timeline.currencyOf(symbol));
  // Every flow's own currency, not just the first one per symbol: cost is now
  // converted per transaction, so a symbol later traded in a second currency
  // needs that currency's rates fetched too.
  for (const tx of txs) currencyUnion.add(tx.price.currency);
  for (const bars of pricesBySymbol.values()) {
    for (const bar of bars) currencyUnion.add(bar.close.currency);
  }
  const sourceCurrencies = [...currencyUnion].filter((ccy) => ccy !== targetCurrency);

  // The historical window starts at INCEPTION, not at `clampedFrom`: cost basis
  // is a cumulative sum over every flow ever made, so a 1M chart still has to
  // price a buy from years ago at the rate of the day it was paid. Anchoring
  // the window to the display range instead would convert those older flows at
  // spot, and the invested line would then disagree between ranges — the very
  // drift this series exists to remove.
  const fromKey = inceptionKey;
  const toKey = to.toISOString().slice(0, 10);

  // Spot rates back the fallback: a date the series cannot price is converted
  // at today's rate and the result is flagged, rather than dropping the holding
  // out of the total entirely.
  const spot = new Map<string, Decimal>([[targetCurrency, new Decimal(1)]]);
  let historical: FxSeries | null = null;
  // Staleness is a property of the stored series as a whole, not of any one
  // pair, and the 7-day rule lives in `getRatesWithProvenance` — reused here so
  // the chart can never disagree with the holdings table about how current its
  // rates are. Left false when nothing had to convert.
  let fxStale = false;
  let fxRatesAsOf: string | null = null;
  if (fxRateService && sourceCurrencies.length > 0) {
    try {
      const { rates, stale, asOf } = await getRatesWithProvenance(
        fxRateService,
        targetCurrency,
        sourceCurrencies,
      );
      for (const [ccy, rate] of rates) spot.set(ccy, rate);
      fxStale = stale;
      fxRatesAsOf = asOf;
    } catch {
      // No spot rates either — only same-currency bars/flows survive below.
    }
    // Capability check, not an instanceof: test stubs and any future
    // history-less source satisfy only the spot contract and must keep working.
    if (typeof (fxRateService as Partial<IHistoricalFxRateService>).getRateSeries === "function") {
      try {
        historical = await (fxRateService as IHistoricalFxRateService).getRateSeries(
          targetCurrency,
          sourceCurrencies,
          fromKey,
          toKey,
        );
      } catch {
        historical = null;
      }
    }
  }

  // Pure: it reports whether a date was approximated, it does not record it.
  // The same lookup is handed to downstream consumers, so a divisor can never
  // differ between the chart and the metrics computed off it.
  const fxLookup: SeriesFxLookup = {
    rateOn(date: string, currency: CurrencyCode): FxConversion | null {
      if (currency === targetCurrency) return { divisor: new Decimal(1), approximated: false };
      const exact = historical?.rateOn(date, currency) ?? null;
      if (exact) return { divisor: exact, approximated: false };
      const fallback = spot.get(currency);
      if (fallback) return { divisor: fallback, approximated: true };
      return null;
    },
  };

  // The build's own honesty flag. Recording it is deliberately a separate,
  // named step at the call sites below rather than a hidden effect of looking a
  // rate up — consumers of `fxLookup` are responsible for their own flag.
  let fxApproximated = false;
  // Every caller of `divisorFor` DROPS the amount on null — a bar goes
  // unvalued, a flow leaves the cost line. The sharpest case is a symbol quoted
  // in a priceable currency but BOUGHT in an unpriceable one: it keeps its
  // market value and loses its whole cost basis, which renders as a phantom
  // gain. Recording the skip here catches both call sites at once.
  let fxIncomplete = false;
  const divisorFor = (date: string, currency: string): Decimal | null => {
    const conversion = fxLookup.rateOn(date, currency);
    if (!conversion) {
      fxIncomplete = true;
      return null;
    }
    if (conversion.approximated) fxApproximated = true;
    return conversion.divisor;
  };

  // Index closes per symbol for O(1) date lookup, kept in the bar's OWN
  // currency and converted inside the per-date loop below — the conversion now
  // depends on the date, so it cannot be hoisted out of it.
  //
  // Each close carries its own currency rather than a single per-symbol one:
  // `bar.close.currency` is authoritative and nothing guarantees a symbol
  // quotes in one currency for the whole window (a provider renaming or
  // re-denominating a listing mid-series would silently mis-convert every bar
  // before the switch). Forward-fill carries the pair, so a filled close is
  // always converted at its own currency's rate.
  const closesBySymbol = new Map<string, Map<string, { close: Decimal; currency: string }>>();
  const barCurrencies = new Map<string, Set<string>>();
  for (const [symbol, bars] of pricesBySymbol) {
    const byDate = new Map<string, { close: Decimal; currency: string }>();
    const ccys = new Set<string>();
    for (const bar of bars) {
      byDate.set(bar.date.toISOString().slice(0, 10), {
        close: bar.close.toDecimal(),
        currency: bar.close.currency,
      });
      ccys.add(bar.close.currency);
    }
    closesBySymbol.set(symbol, byDate);
    barCurrencies.set(symbol, ccys);
  }

  // Cost basis, converted flow by flow at the rate of the day each flow was
  // PAID. The accumulation rules (buys add, sells subtract, splits and
  // dividends are no-ops) live in core next to `replayHoldings` and are shared
  // with it, so they cannot drift from the holdings replay this series is
  // plotted against.
  const investedSeries = replayConvertedInvested(txs, divisorFor);

  // Only a symbol that actually carries a split row can have a basis to
  // correct, so a book without any skips the query entirely — which is most
  // books. Detecting that costs one pass over transactions already in memory.
  const splitSymbols = [...new Set(txs.filter((t) => t.type === "split").map((t) => t.symbol))];
  let splitBasis: SplitBasisResolution = resolveSplitBasis([], [], new Map());
  if (splitSymbols.length > 0) {
    const { findings, checkedBySymbol } = await findBasisMismatches({ db, fxRateService }, userId, {
      symbols: splitSymbols,
    });
    splitBasis = resolveSplitBasis(txs, findings, checkedBySymbol);
  }

  // Warm-up bars are for seeding only: a date before the window start must not
  // become a point, or every range would begin two weeks early.
  const allDates = new Set<string>();
  for (const byDate of closesBySymbol.values()) {
    for (const date of byDate.keys()) if (date >= windowStartKey) allDates.add(date);
  }
  const sortedDates = [...allDates].sort();

  const lastClose = new Map<string, { close: Decimal; currency: string; date: string }>();
  // Carry the last bar from before the window in, so day one forward-fills
  // like every other day instead of valuing only whatever traded that morning.
  for (const [symbol, byDate] of closesBySymbol) {
    let latest: string | null = null;
    for (const date of byDate.keys()) {
      if (date < windowStartKey && (latest === null || date > latest)) latest = date;
    }
    if (latest !== null) lastClose.set(symbol, { ...byDate.get(latest)!, date: latest });
  }
  const contributing = new Set<string>();
  // Symbols already represented in an EMITTED point. A symbol joining the
  // series later brings its market value and its whole original cost on the
  // same day; netting only the cost would book its accumulated unrealised gain
  // as one day's return. Tracking arrivals lets `flowBasis` treat each as what
  // it economically is — a transfer-in at market value. Keyed on emitted points
  // rather than every date, because a date with no market value is skipped
  // below and must not silently consume a symbol's arrival.
  const arrived = new Set<string>();
  // Symbols found held-but-unpriceable on at least one emitted point. Filled
  // inside the loop below and published as `historyIncomplete`.
  const heldUnpriced = new Set<string>();
  // Symbols valued from a close carried further than a closed market explains,
  // against the oldest such close. Distinct from `heldUnpriced`: these ARE in
  // the total, at a price that may be weeks old.
  const stalePricedAsOf = new Map<string, string>();
  let entryAdjustment = new Decimal(0);
  const points: {
    date: string;
    marketValue: Decimal;
    invested: Decimal;
    flowBasis: Decimal;
  }[] = [];
  for (const date of sortedDates) {
    const snap = timeline.asOf(date);
    // A symbol is priceable on this date once it has a known (or forward-
    // filled) converted close. Its cost enters the series on the same day its
    // value does — a symbol with missing/late bars contributes neither, so it
    // can't inject a flow with no matching market value.
    const priceable = new Set<string>();
    const valueOf = new Map<string, Decimal>();
    let total = new Decimal(0);
    // Had a bar today but no FX rate to convert it. Unpriceable, but for a
    // reason that has nothing to do with missing history — see `heldUnpriced`
    // below, which must not claim these have no stored prices.
    const fxBlocked = new Set<string>();
    for (const symbol of timeline.symbols) {
      const own = closesBySymbol.get(symbol)?.get(date);
      const native = own ? { ...own, date } : lastClose.get(symbol);
      if (!native) continue; // before the symbol's first bar — no known price yet
      lastClose.set(symbol, native);
      // Carried further than a closed market explains. Recorded, never dropped:
      // see STALE_PRICE_DAYS. Custom holdings are exempt — a manual mark is
      // MEANT to stand until the owner changes it, so "stale" is its normal
      // state and flagging it would make the signal useless.
      if (!own && !customSymbols.has(symbol)) {
        const ageMs = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${native.date}T00:00:00Z`);
        if (ageMs > STALE_PRICE_DAYS * 86_400_000) {
          const seen = stalePricedAsOf.get(symbol);
          if (seen === undefined || native.date < seen) stalePricedAsOf.set(symbol, native.date);
        }
      }
      const divisor = divisorFor(date, native.currency);
      if (!divisor) {
        fxBlocked.add(symbol); // cannot value this bar in the target currency
        continue;
      }
      const close = native.close.dividedBy(divisor);
      priceable.add(symbol);
      const rawQty = snap.quantities.get(symbol);
      if (!rawQty || rawQty.isZero()) continue; // not held on this date (pre-buy or fully sold)
      // Back-adjusted price history is quoted on the POST-split basis for every
      // date, including ones before the split happened, while the ledger's
      // quantity for those dates is pre-split. Multiplying the two mixes bases.
      // The factor is 1 for every symbol without an established adjusted
      // history, which is nearly all of them.
      const qty = rawQty.times(splitBasis.factorAt(symbol, date));
      const value = close.times(qty);
      valueOf.set(symbol, value);
      total = total.plus(value);
      contributing.add(symbol);
    }
    if (total.greaterThan(0)) {
      // Held on a date this series actually values, but with no price of its
      // own: the holding is in the ledger and contributes nothing, so when it
      // does become priceable it arrives carrying its whole accumulated gain.
      // That arrival is the distortion this flag exists to disclose.
      //
      // Deliberately NOT "its first bar is later than the window start". The
      // window start is a CALENDAR date while bars fall on TRADING days, so a
      // range opening on a weekend or holiday has no bar for anyone on day one
      // — and YTD always opens on 1 January. That comparison flagged the entire
      // book on the range the overview publishes.
      //
      // The window's own first day is exempt. `ManualPriceProvider` seeds a
      // custom holding's bar AT the window start so it does not vanish from
      // charts, which manufactures a point on a date no exchange traded — 1
      // January, for YTD. Every real listing is then held-but-unpriced on it,
      // and the whole book gets named. A gap that lasts beyond day one is
      // still caught on day two.
      if (date !== windowStartKey) {
        for (const symbol of timeline.symbols) {
          if (priceable.has(symbol)) continue;
          // A bar exists, only the FX rate is missing. `fxIncomplete` already
          // reports that, and saying "no stored price history" here would be
          // false — and unclearable, since no backfill can conjure a rate.
          if (fxBlocked.has(symbol)) continue;
          const qty = snap.quantities.get(symbol);
          if (qty !== undefined && qty.greaterThan(0)) heldUnpriced.add(symbol);
        }
      }
      let invested = new Decimal(0);
      for (const symbol of timeline.symbols) {
        // A symbol still HELD contributes its cost only once it can be priced,
        // so cost never appears without a matching market value. A symbol no
        // longer held has no market value to match — only the residue
        // cumulative net-invested leaves behind when a position is closed at a
        // profit or a loss — and gating that on priceability made the cost line
        // depend on whether the store happened to hold the symbol's old bars
        // inside the window.
        //
        // Found on a real book: one closed position, sold at a profit, whose
        // last stored bar predated a 1M window but not a 3M one. Every longer
        // range counted its negative residue and 1M did not, so 1M reported a
        // cost line a few hundred kroner higher than every other range for the
        // same day, with market value identical to the cent. The residue is a
        // ledger fact and does not change with the range.
        const held = snap.quantities.get(symbol);
        if (held !== undefined && !held.isZero() && !priceable.has(symbol)) continue;
        const amount = investedSeries.investedOn(symbol, date);
        if (amount === null) continue; // no transactions yet, or no rate for them
        invested = invested.plus(amount);
        // First appearance in the series: charge the flow at market value
        // instead of at cost, so the gain it walked in with is not counted as
        // having been earned today. For an ordinary buy the two are the same
        // number — bought at the day's price — so this is a no-op there, and
        // only bites for a holding that joined mid-window.
        if (!arrived.has(symbol)) {
          arrived.add(symbol);
          entryAdjustment = entryAdjustment.plus(
            (valueOf.get(symbol) ?? new Decimal(0)).minus(amount),
          );
        }
      }
      points.push({
        date,
        marketValue: total,
        invested,
        flowBasis: invested.plus(entryAdjustment),
      });
    }
  }

  // ---- the newest point is priced the way the portfolio is -----------------
  //
  // The rule the series already follows for every other date is "value it at
  // the most recent price known FOR that date", which for a past date is its
  // close. For the newest date the most recent price known is the quote — and
  // `portfolio-view` values every holding from exactly that. Leaving this point
  // on closes put two totals for "what this is worth" on one screen: 169,459.28
  // under the hero, 168,864.01 in the card below it, 595 DKK apart on the
  // reporting book. Same day, same holdings, two price fields.
  //
  // Per symbol, and only forward: a quote older than the point's own date is a
  // staler answer than the close already in hand, so that symbol keeps its
  // close. Custom holdings land there by construction — their quote is the last
  // manual mark, which is the same number the series forward-filled — so they
  // are untouched rather than mixed.
  const newest = points[points.length - 1];
  if (newest !== undefined) {
    const snap = timeline.asOf(newest.date);
    let total = newest.marketValue;
    for (const symbol of timeline.symbols) {
      const rawQty = snap.quantities.get(symbol);
      if (rawQty === undefined || !rawQty.greaterThan(0)) continue;
      const close = lastClose.get(symbol);
      if (!close) continue; // unpriced on this date; nothing to replace
      try {
        const quote = await provider.getQuote(symbol);
        if (quote.asOf.toISOString().slice(0, 10) < newest.date) continue;
        const conversion = fxLookup.rateOn(newest.date, quote.price.currency);
        const closeConversion = fxLookup.rateOn(newest.date, close.currency);
        if (!conversion || !closeConversion) continue;
        const qty = rawQty.times(splitBasis.factorAt(symbol, newest.date));
        const was = close.close.dividedBy(closeConversion.divisor).times(qty);
        const now = quote.price.toDecimal().dividedBy(conversion.divisor).times(qty);
        total = total.minus(was).plus(now);
      } catch {
        // No quote for this symbol: it keeps the close, exactly as before.
      }
    }
    newest.marketValue = total;
  }

  // "FX conversion contributed" — true when any contributing symbol was quoted
  // in, or transacted in, a currency other than the target.
  let multiCurrency = false;
  for (const symbol of contributing) {
    if (timeline.currencyOf(symbol) !== targetCurrency) {
      multiCurrency = true;
      break;
    }
    const ccys = barCurrencies.get(symbol);
    if (ccys && [...ccys].some((ccy) => ccy !== targetCurrency)) {
      multiCurrency = true;
      break;
    }
  }

  // Truncation arm. The loop above can only notice a gap it was able to VALUE
  // — it needs a priced neighbour on a date inside the gap. When every holding
  // is short at once, which is exactly the cold-store case this flag exists
  // for, no point is emitted in the gap at all: the series simply starts late,
  // every symbol arrives together, and the loop stays silent while the range
  // quietly covers less than its name claims.
  //
  // So also compare each held symbol's first bar against the first date the
  // series managed to value, and report anything that was already held more
  // than a closed market's worth of days before it.
  const firstPointKey = points[0]?.date;
  if (firstPointKey !== undefined) {
    const toleranceMs = CLOSED_MARKET_TOLERANCE_DAYS * 86_400_000;
    for (const symbol of timeline.symbols) {
      if (heldUnpriced.has(symbol)) continue;
      const firstTrade = firstTradeBySymbol.get(symbol);
      if (firstTrade === undefined) continue;
      const requiredKey = firstTrade > windowStartKey ? firstTrade : windowStartKey;
      if (requiredKey >= firstPointKey) continue; // priced from the moment it was held
      const heldQty = timeline.asOf(requiredKey).quantities.get(symbol);
      if (heldQty === undefined || heldQty.isZero()) continue;
      const gapMs =
        Date.parse(`${firstPointKey}T00:00:00Z`) - Date.parse(`${requiredKey}T00:00:00Z`);
      if (gapMs > toleranceMs) heldUnpriced.add(symbol);
    }
  }

  return {
    targetCurrency,
    multiCurrency,
    range,
    clampedFrom,
    to,
    points,
    timeline,
    splitBasis,
    fxLookup,
    fxApproximated,
    fxIncomplete,
    fxStale,
    fxRatesAsOf,
    historyIncomplete: [...heldUnpriced].sort(),
    stalePrices: [...stalePricedAsOf.entries()]
      .map(([symbol, asOf]) => ({ symbol, asOf }))
      .sort((a, b) => (a.symbol < b.symbol ? -1 : 1)),
    rows,
  };
}

/**
 * Benchmarks, and the one rule that governs what may appear here: **every
 * series must be a TOTAL-RETURN series.**
 *
 * A portfolio's TWR folds dividend income into the return —
 * `r_t = (MV_t + D_t - F_t) / MV_{t-1} - 1` in `computeDailyReturns`. Measuring
 * it against a *price* index compares a book that keeps its dividends to an
 * index that throws them away, and the gap the UI prints is then the
 * portfolio's skill plus the index's yield. That is not a rounding error:
 * measured 2026-09-10, `^GSPC` returned +16.22% over one year against
 * `^SP500TR`'s +17.58%, so the old pairing flattered every book by 1.36pp a
 * year, compounding over longer ranges. On the maintainer's demo book it turned
 * a real +0.5pp into a printed +1.8pp.
 *
 * Two ways to get a total return, both used here:
 *  - a total-return *index* (`^SP500TR`), where the reinvestment is in the
 *    index itself. History reaches 1988.
 *  - an *accumulating* ETF (`IWDA.L`), which reinvests distributions internally
 *    rather than paying them out, so its own price is the total return. Chosen
 *    over the distributing `URTH` deliberately: same USD quote, no adjusted-close
 *    plumbing needed, and history back to 2009 rather than 2012. Its return is
 *    net of a 0.20% TER, which is honest — it is what you could actually have
 *    bought.
 *
 * **There is deliberately no price-index fallback.** Falling back from
 * `^SP500TR` to `^GSPC` would silently restore the bias on exactly the days the
 * TR series is unavailable, and a silently-wrong comparison is worse than an
 * absent one. `fetchBenchmarkSeries` drops a benchmark it cannot fetch, and
 * `performance-view` renders nothing for it.
 *
 * Note for upgrades: these symbols are cold in an existing `price_daily`, so the
 * first load after this change has no benchmark until the store warms. It
 * self-heals; see `PersistedPriceProvider`'s refresh budget.
 */
export const BENCHMARKS: Record<string, { name: string; symbols: string[] }> = {
  sp500: { name: "S&P 500 (TR)", symbols: ["SP500TR.INDX", "^SP500TR"] },
  "msci-world": { name: "MSCI World (TR)", symbols: ["IWDA.L"] },
};

export async function fetchBenchmarkSeries(
  provider: IMarketDataProvider,
  ids: string[],
  from: Date,
  to: Date,
  opts?: {
    /** See `HistoryOptions.cacheOnly`. A cold benchmark symbol (one of up to
     *  three sequential variants per id — `symbols` above) would otherwise
     *  block this function unconditionally on the FIRST variant tried; there
     *  is no bounded-wait option here, only "wait" or "never wait", so a
     *  caller that cannot afford to wait must opt out entirely rather than
     *  pass a deadline. */
    cacheOnly?: boolean;
  },
): Promise<{ id: string; name: string; bars: { date: string; close: Decimal }[] }[]> {
  const benchmarkSymbols: { id: string; name: string; symbols: string[] }[] = ids
    .filter((id) => BENCHMARKS[id])
    .map((id) => ({ id, ...BENCHMARKS[id]! }));

  const results: { id: string; name: string; bars: { date: string; close: Decimal }[] }[] = [];

  await Promise.all(
    benchmarkSymbols.map(async ({ id, name, symbols }) => {
      for (const sym of symbols) {
        try {
          const bars = await provider.getHistoricalPrices(sym, from, to, {
            cacheOnly: opts?.cacheOnly ?? false,
          });
          if (bars.length === 0) continue;

          const firstClose = bars[0]!.close.toDecimal();
          if (firstClose.isZero()) continue;

          const mapped = bars.map((bar) => ({
            date: bar.date.toISOString().slice(0, 10),
            close: bar.close.toDecimal(),
          }));

          results.push({ id, name, bars: mapped });
          return;
        } catch {
          // Try next symbol variant
        }
      }
    }),
  );

  return results;
}
