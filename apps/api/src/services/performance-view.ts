import {
  Decimal,
  computeDailyReturns,
  chainedTWR,
  annualize,
  growthIndex,
  volatility,
  maxDrawdown,
  bestWorstDay,
  returnsFromIndex,
  pairReturns,
  beta,
  MIN_PAIRED_DAYS_FOR_BETA,
  resolveSplitBasis,
} from "@sage/core";
import type { PortfolioViewDeps } from "./portfolio-view";
import { findBasisMismatches, toBasisFindingBody } from "./basis-reconciliation";
import { computeLifetimeReturn } from "./lifetime-return";
import {
  buildValuationSeries,
  fetchBenchmarkSeries,
  rangeSchema,
  CLOSED_MARKET_TOLERANCE_DAYS,
} from "./valuation-series";
import type { PortfolioBook } from "./portfolio-book";

export const DEFAULT_BENCHMARKS = ["sp500", "msci-world"];

/** `DEFAULT_BENCHMARKS[0]`, named and exported so a caller that wants exactly
 *  the primary default (the dashboard's embedded YTD card, which draws no
 *  chart and so shows only one) has something to import instead of
 *  hand-copying the string. Whatever this repo picks as the primary default
 *  moves every caller of it at once. */
export const PRIMARY_BENCHMARK_ID = DEFAULT_BENCHMARKS[0]!;

function toNum(d: Decimal | null): number | null {
  return d === null ? null : Number(d.toFixed(6));
}

interface RatioBlock {
  value: number;
  benchmark: number;
  ratio: number;
}

interface PerformanceRelative {
  benchmarkId: string;
  benchmarkName: string;
  pairedDays: number;
  minPairedDaysForBeta: number;
  volatility: RatioBlock | null;
  maxDrawdown: RatioBlock | null;
  beta: number | null;
}

/** A portfolio figure paired with the benchmark's own, plus their ratio.
 *  Null when either side is missing or the benchmark figure is zero: a zero
 *  denominator makes the ratio undefined, and rendering an infinite or
 *  clamped-at-2x marker would read as a real measurement. */
function ratioBlock(mine: Decimal | null, theirs: Decimal | null): RatioBlock | null {
  if (mine === null || theirs === null || theirs.isZero()) return null;
  return {
    value: Number(mine.toFixed(6)),
    benchmark: Number(theirs.toFixed(6)),
    ratio: Number(mine.dividedBy(theirs).toFixed(6)),
  };
}

/**
 * Return metrics for a user's portfolio over `range`, plus what the whole book
 * has made in `lifetime`.
 *
 * Every flow is converted at the rate of its own trade date; when any of them
 * (or the underlying valuation series) had to fall back to a spot rate, the
 * response says so via `fxApproximated` rather than presenting an approximated
 * figure as exact. A currency nothing can price is dropped and reported as
 * `fxIncomplete`; rates past the staleness threshold are reported as `fxStale`
 * with the day they came from.
 *
 * There is deliberately no money-weighted return here any more.
 *
 * The arithmetic was never wrong — it reproduced to four decimal places — but
 * the flows handed to it are not the flows that happened. Sage has no cash or
 * settlement account: when the reporting book was restructured in one week of
 * October 2025, 166,906 DKK of sales and 192,495 of purchases went through a
 * portfolio worth 145,000, and every one of those round trips was read as a
 * withdrawal followed by a deposit rather than as money moving between
 * holdings. IRR prices that shape as brilliant timing and returned 35.9% for a
 * year the time-weighted return puts at 14.6%.
 *
 * It is a question worth answering — did the timing help? is exactly what a
 * time-weighted return refuses to tell you — and the price of answering it is
 * a settlement model, either recorded by the holder or inferred by matching
 * sales to nearby purchases. Until there is one, no number goes here. The same
 * gap still shapes `simpleReturn` and the invested line, more quietly.
 */
export async function buildPerformanceView(
  deps: PortfolioViewDeps,
  userId: string,
  opts: {
    range?: string;
    currency?: string | null;
    benchmarks?: string[];
    book?: PortfolioBook;
    repairHistory?: boolean;
    /** Passed straight to `fetchBenchmarkSeries` as `cacheOnly`: a cold
     *  benchmark (never fetched into the store) answers with nothing instead
     *  of blocking. For a caller embedded in a `Promise.all` with other views
     *  that must not hang on this one — GET /performance, whose entire
     *  purpose IS this figure, leaves it false and pays to fetch. */
    benchmarksCacheOnly?: boolean;
  },
) {
  const range = rangeSchema.parse(opts.range);
  const currency = opts.currency ?? opts.book?.targetCurrency ?? null;

  const series = await buildValuationSeries(deps, userId, {
    range,
    currency,
    book: opts.book,
    repairHistory: opts.repairHistory ?? false,
  });

  // A basis mismatch belongs to the book, not to a range, so this is computed
  // once and published on every return path below — including the ones that
  // give up on a return figure. A page that cannot measure performance can
  // still warn that the prices underneath it disagree with the ledger.
  const { findings: basisFindings, fxGapSymbols } = await findBasisMismatches(
    { db: deps.db, fxRateService: deps.fxRateService },
    userId,
  );
  // The series already decided which symbols it corrected. Reading its verdict
  // rather than forming a second opinion is what stops a corrected holding from
  // still carrying a warning; an empty series corrected nothing.
  const splitBasis = "empty" in series ? resolveSplitBasis([], [], new Map()) : series.splitBasis;
  const basisMismatches = basisFindings
    .filter((f) => splitBasis.verdictOf(f.symbol) !== "adjusted")
    .map(toBasisFindingBody);
  // Published beside `unverifiedSplits`, never merged into it: a split goes
  // unchecked either because no trade landed on a stored-price day or because
  // a trade's currency had no rate to convert against, and the two have
  // opposite remedies. /corporate-actions has always told them apart
  // (`action-row.tsx`); dropping this field here is what let /performance's
  // banner assert the wrong one and contradict that page about one holding.
  const unverifiedSplits = splitBasis.unverified;
  // Same rule as `basisMismatches` above: a page that cannot measure
  // performance can still say its prices are short. An empty series never
  // fetched anything, so it has nothing incomplete to report.
  const historyIncomplete = "empty" in series ? [] : series.historyIncomplete;
  // Every split symbol in the book, not just the unverified ones — lets the
  // web banner tell "a finding on a symbol that actually split" (which
  // /corporate-actions has a row for) apart from "a finding on a symbol that
  // never split at all" (which it does not), without this function forming a
  // second opinion about the split itself.
  const splitSymbols =
    "empty" in series
      ? []
      : [...new Set(series.rows.filter((r) => r.type === "split").map((r) => r.instrumentSymbol))];

  if ("empty" in series || series.points.length < 2) {
    return {
      displayCurrency: series.targetCurrency,
      range,
      window: null,
      gain: null,
      simpleReturn: null,
      insufficientData: true,
      twr: null,
      twrAnnualized: null,
      lifetime: null,
      volatility: null,
      maxDrawdown: null,
      bestDay: null,
      worstDay: null,
      indexSeries: [],
      benchmarks: [],
      relative: null,
      basisMismatches,
      unverifiedSplits,
      fxGapSymbols,
      historyIncomplete,
      stalePrices: "empty" in series ? [] : series.stalePrices,
      splitSymbols,
      multiCurrency: "empty" in series ? false : series.multiCurrency,
      anomalousDays: 0,
      fxApproximated: "empty" in series ? false : series.fxApproximated,
      fxIncomplete: "empty" in series ? false : series.fxIncomplete,
      fxStale: "empty" in series ? false : series.fxStale,
      fxRatesAsOf: "empty" in series ? null : series.fxRatesAsOf,
    };
  }

  const points = series.points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const windowDays = Math.round(
    (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) / 86_400_000,
  );

  // Every flow below converts at the rate of its OWN trade date. A flow the
  // historical series cannot price still converts, at spot — but it drags the
  // whole response's honesty flag with it, so an approximated IRR or TWR is
  // never presented as exact. The series' own approximations count too.
  let fxApproximated = series.fxApproximated;
  // Same contract as above for the flows converted below: one this lookup
  // cannot price at all is skipped, which quietly removes it from the IRR. The
  // series' own skips count too.
  let fxIncomplete = series.fxIncomplete;

  // Dividend income by pay date, converted at the rate of the PAY date (skip
  // currencies without an FX rate — same rule the valuation series applies).
  const dividendsByDate = new Map<string, Decimal>();
  for (const row of series.rows) {
    if (row.type !== "dividend") continue;
    if (row.tradeDate < first.date || row.tradeDate > last.date) continue;
    const conversion = series.fxLookup.rateOn(row.tradeDate, row.currency);
    if (!conversion) {
      fxIncomplete = true;
      continue;
    }
    if (conversion.approximated) fxApproximated = true;
    const amount = new Decimal(row.quantity).times(row.price).dividedBy(conversion.divisor);
    dividendsByDate.set(
      row.tradeDate,
      (dividendsByDate.get(row.tradeDate) ?? new Decimal(0)).plus(amount),
    );
  }

  const { returns, anomalies } = computeDailyReturns(points, dividendsByDate);
  if (returns.length === 0) {
    // Points existed but no measurable period (e.g. zero-value bases throughout).
    return {
      displayCurrency: series.targetCurrency,
      range,
      window: { from: first.date, to: last.date, days: windowDays },
      gain: null,
      simpleReturn: null,
      insufficientData: true,
      twr: null,
      twrAnnualized: null,
      lifetime: null,
      volatility: null,
      maxDrawdown: null,
      bestDay: null,
      worstDay: null,
      indexSeries: [],
      benchmarks: [],
      relative: null,
      basisMismatches,
      unverifiedSplits,
      fxGapSymbols,
      historyIncomplete,
      stalePrices: series.stalePrices,
      splitSymbols,
      multiCurrency: series.multiCurrency,
      anomalousDays: anomalies,
      fxApproximated,
      fxIncomplete,
      fxStale: series.fxStale,
      fxRatesAsOf: series.fxRatesAsOf,
    };
  }

  const twr = chainedTWR(returns);
  const index = growthIndex(returns, first.date);
  const vol = volatility(returns);
  const drawdown = maxDrawdown(index);
  const bw = bestWorstDay(returns);

  // What the book has made outside this window and outside its open positions.
  //
  // Kept as two named parts rather than one total because only a caller holding
  // today's positions can finish the sum, and because the parts answer
  // different questions: `realised` is every sale ever made, `income` the cash
  // that actually landed after the tax taken off it. Sage reported neither, and
  // called unrealised-plus-gross-dividends "total return" — on the reporting
  // book 8,203.66, against a broker's 2,904.68 for the open positions and
  // 23,355.74 for the book's life. A third number, equal to neither.
  //
  // Its honesty flags are OR'd into this view's: the contract on
  // `fxApproximated` and `fxIncomplete` is that a consumer making further
  // `fxLookup` calls folds its own in before publishing.
  const lifetimeParts = computeLifetimeReturn(
    series.rows,
    series.fxLookup,
    series.targetCurrency,
    last.date,
  );
  if (lifetimeParts.approximated) fxApproximated = true;
  if (lifetimeParts.incomplete) fxIncomplete = true;
  const unrealised = last.marketValue.minus(lifetimeParts.openCost);
  const money = (d: Decimal) => ({ amount: d.toFixed(2), currency: series.targetCurrency });
  const lifetime = {
    unrealised: money(unrealised),
    realised: money(lifetimeParts.realised),
    income: money(lifetimeParts.income),
    total: money(unrealised.plus(lifetimeParts.realised).plus(lifetimeParts.income)),
  };

  const benchmarkIds = opts.benchmarks ?? DEFAULT_BENCHMARKS;
  const fetched = await fetchBenchmarkSeries(
    deps.provider,
    benchmarkIds,
    series.clampedFrom,
    series.to,
    { cacheOnly: opts.benchmarksCacheOnly ?? false },
  );
  // Measure each benchmark over the window the PORTFOLIO was actually measured
  // over, not the window that was requested. Anchoring to `bars[0]` compared
  // two different periods whenever the two series did not start together — the
  // index gets a head start on a book whose own history begins later, and the
  // "gap in percentage points" the UI prints is then a difference between a
  // longer index run and a shorter portfolio run.
  const benchmarkToleranceMs = CLOSED_MARKET_TOLERANCE_DAYS * 86_400_000;
  const benchmarks = fetched.flatMap((bm) => {
    const within = bm.bars.filter((bar) => bar.date >= first.date && bar.date <= last.date);
    if (within.length < 2) return [];
    // An index that cannot reach back to where the portfolio starts cannot be
    // compared to it. Dropping it shows nothing, which is honest; keeping it
    // would print a confident number measuring the wrong span. The tolerance is
    // for calendars, not coverage — a US index simply does not trade on every
    // day a European book has a bar for.
    if (Date.parse(within[0]!.date) - Date.parse(first.date) > benchmarkToleranceMs) return [];

    const firstClose = within[0]!.close;
    const lastClose = within[within.length - 1]!.close;
    return [
      {
        id: bm.id,
        name: bm.name,
        twr: Number(lastClose.minus(firstClose).dividedBy(firstClose).toFixed(6)),
        // Normalised to the same anchor the figure uses, so the chart and the
        // number can never tell different stories.
        points: within.map((bar) => ({
          date: bar.date,
          value: Number(bar.close.dividedBy(firstClose).toFixed(6)),
        })),
      },
    ];
  });

  // The scales take one benchmark, not all of them: the defaults track each
  // other closely enough that two pins would overlap into a smudge. The chart
  // still draws every benchmark.
  //
  // Selected by id, not by position: `fetchBenchmarkSeries` pushes into its
  // result array from inside a `Promise.all`, so arrival order follows whichever
  // fetch resolved first, not the requested order. Falling back to whatever did
  // arrive keeps the scales working when the preferred benchmark alone fails.
  const primary = fetched.find((b) => b.id === benchmarkIds[0]) ?? fetched[0] ?? null;
  let relative: PerformanceRelative | null = null;
  if (primary && primary.bars.length > 1) {
    const base = primary.bars[0]!.close;
    const bmIndex = primary.bars.map((b) => ({ date: b.date, value: b.close.dividedBy(base) }));
    const bmReturns = returnsFromIndex(bmIndex);
    const paired = pairReturns(returns, bmReturns);
    relative = {
      benchmarkId: primary.id,
      benchmarkName: primary.name,
      pairedDays: paired.length,
      // The response states the rule it applied, so a suppressed beta is
      // explicable from the payload alone and the UI never hardcodes a copy.
      minPairedDaysForBeta: MIN_PAIRED_DAYS_FOR_BETA,
      volatility: ratioBlock(vol, volatility(bmReturns)),
      maxDrawdown: ratioBlock(drawdown, maxDrawdown(bmIndex)),
      beta: toNum(beta(paired)),
    };
  }

  const annualizedGate = windowDays > 365;
  // What the book actually MADE over this window, in money. Not a kroner
  // reading of the time-weighted return — a TWR strips out deposits and so
  // corresponds to no amount at all; putting one in its parentheses would be a
  // fabricated figure. This is the change in (value − money in) across the
  // window, so a deposit lifts both ends and cancels, and it is the same
  // quantity the overview's range cell prints. The two pages then report one
  // pair with different emphasis instead of a percentage on one and an amount
  // on the other with no way to see both.
  const gainDelta = last.marketValue
    .minus(last.invested)
    .minus(first.marketValue.minus(first.invested));
  // The same money over what had been paid in when the window opened. This is
  // the rate the OVERVIEW prints, and publishing it here is the point: the two
  // pages were reporting different percentages for one window — 9.46% against
  // 14.57% on the reporting book — and a reader could only discover they are
  // different measures by noticing the discrepancy. Now they sit side by side
  // on the page whose job is defining measures.
  const simpleReturn = first.invested.isZero()
    ? null
    : Number(gainDelta.dividedBy(first.invested).toFixed(6));
  return {
    displayCurrency: series.targetCurrency,
    range,
    window: { from: first.date, to: last.date, days: windowDays },
    gain: { amount: gainDelta.toFixed(2), currency: series.targetCurrency },
    lifetime,
    simpleReturn,
    insufficientData: false,
    twr: toNum(twr),
    twrAnnualized: annualizedGate ? toNum(annualize(twr, windowDays)) : null,
    volatility: toNum(vol),
    maxDrawdown: toNum(drawdown),
    bestDay: bw ? { date: bw.best.date, value: Number(bw.best.value.toFixed(6)) } : null,
    worstDay: bw ? { date: bw.worst.date, value: Number(bw.worst.value.toFixed(6)) } : null,
    indexSeries: index.map((p) => ({ date: p.date, value: Number(p.value.toFixed(6)) })),
    benchmarks,
    relative,
    basisMismatches,
    unverifiedSplits,
    fxGapSymbols,
    historyIncomplete,
    stalePrices: series.stalePrices,
    splitSymbols,
    multiCurrency: series.multiCurrency,
    anomalousDays: anomalies,
    fxApproximated,
    fxIncomplete,
    fxStale: series.fxStale,
    fxRatesAsOf: series.fxRatesAsOf,
  };
}
