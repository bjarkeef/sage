import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import type { IMarketDataProvider, IFxRateService } from "@sage/provider-interface";
import { Decimal } from "@sage/core";
import type { Database } from "../db/client";
import { buildPortfolioView } from "../services/portfolio-view";
import { buildDividendIncomeView } from "../services/dividend-income-view";
import { buildDiversificationView, type DimRowDTO } from "../services/diversification-view";
import { buildPortfolioHistoryView } from "../services/portfolio-history-view";
import { buildPerformanceView, PRIMARY_BENCHMARK_ID } from "../services/performance-view";
import { loadPortfolioBook } from "../services/portfolio-book";
import type { MoneyDTO } from "../dto";
import { reconcileDividends } from "../services/dividend-reconciliation";

type IncomeView = Awaited<ReturnType<typeof buildDividendIncomeView>>;
type AnnouncedRow = IncomeView["announced"][number];
type ProjectedRow = IncomeView["projected"][number];
type RetroactiveRow = IncomeView["retroactive"][number];
type MonthlyBreakdownRow = IncomeView["summary"]["monthlyBreakdown"][number];

const WINDOW_DAYS = 30;
const MAX_ROWS = 5;
const MIN_ROWS = 3;
const MAX_STREAM_POINTS = 800;

export interface UpcomingRow {
  symbol: string;
  name: string;
  /** The date the card displays — payment date, or ex-date when unknown. */
  date: string;
  income: string;
  currency: string;
  /** Sage predicted this date rather than the company declaring it. */
  dateEstimated: boolean;
  /** The whole payment is a forecast, not a declared dividend. */
  projected: boolean;
}

/** Announced and projected rows within the next 30 days, ascending on the
 *  date the card displays (paymentDate, falling back to the ex-date — never
 *  the exDate alone, which the old selector filtered and sorted on while the
 *  card rendered paymentDate, letting the two axes diverge), capped at 5.
 *  Floored at 3: when fewer than three fall inside the 30-day window the
 *  list reaches past it rather than collapsing to a couple of rows beside a
 *  full Portfolio card. Exported for direct unit testing (pure — "today" is
 *  an argument rather than read from the clock). */
export function selectUpcoming(
  announced: AnnouncedRow[],
  projected: ProjectedRow[],
  todayIso: string,
): UpcomingRow[] {
  const horizon = addDays(todayIso, WINDOW_DAYS);
  const rows: UpcomingRow[] = [
    ...announced.map((a) => ({
      symbol: a.symbol,
      name: a.name,
      date: a.paymentDate ?? a.exDate,
      income: a.income,
      currency: a.currency,
      dateEstimated: a.paymentDateEstimated,
      projected: false,
    })),
    ...projected.map((p) => ({
      symbol: p.symbol,
      name: p.name,
      date: p.paymentDate ?? p.projectedExDate,
      income: p.income,
      currency: p.currency,
      dateEstimated: p.paymentDateEstimated,
      projected: true,
    })),
  ]
    .filter((r) => r.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date));

  const inWindow = rows.filter((r) => r.date <= horizon);
  return (inWindow.length >= MIN_ROWS ? inWindow : rows).slice(0, MAX_ROWS);
}

/** Monday reaches back to Friday; other weekdays to yesterday.
 *  Exported for direct unit testing (pure — "today" is an argument). */
export function previousMarketDay(todayIso: string): string {
  const d = new Date(`${todayIso}T00:00:00Z`);
  const back = d.getUTCDay() === 1 ? 3 : 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Adds `n` months to an ISO date in UTC, clamping the day so that adding to
 *  the 31st never rolls into the following month (JS Date would turn
 *  2026-03-31 minus one month into 2026-03-03). */
function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/** Adds `n` days to an ISO date, in UTC — same arithmetic shape as
 *  previousMarketDay, so callers stay immune to local-timezone drift. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** How sure Sage is that a payment happens for the amount shown. The three
 *  tiers are not a scale Sage invents — they are exactly the three arrays the
 *  income view already returns, which is why the stream can be built from a
 *  payload the dashboard was loading anyway. */
export type PaymentCertainty = "paid" | "confirmed" | "estimated";

export interface IncomeStreamPointDTO {
  /** Payment date, falling back to the ex-date when the payer has not named
   *  one — same fallback `selectUpcoming` uses, so a payment cannot appear on
   *  two different days depending on which component drew it. */
  date: string;
  /** Already in the display currency: the income view FX-converts all three
   *  arrays before they leave it. Gross — the tax rate travels separately on
   *  `income.dividendTaxRate` and is applied at render, the way every other
   *  income surface in the app does it. */
  amount: string;
  currency: string;
  symbol: string;
  certainty: PaymentCertainty;
}

/** Twelve months back and twelve forward, every payment as one point.
 *
 *  The window is symmetric on purpose: the forward half is the span the hero
 *  figure names ("income, next twelve months"), so the reader can see the
 *  figure's own territory rather than being asked to trust it. The backward
 *  half is what makes the forward half legible — a lumpy book looks like a
 *  forecasting artefact until you can see it was lumpy last year too.
 *
 *  Capped, because a monthly-paying book of a few hundred holdings would
 *  otherwise put thousands of points on the wire for a chart 1,200px wide.
 *  The cap drops the OLDEST points first: the right-hand half is the half the
 *  headline is about.
 *
 *  Pure — "today" is an argument, not a clock read — so it unit-tests directly
 *  and cannot rot the way a fixture with a hardcoded date does.
 */
export function selectIncomeStream(
  retroactive: RetroactiveRow[],
  announced: AnnouncedRow[],
  projected: ProjectedRow[],
  todayIso: string,
): IncomeStreamPointDTO[] {
  const from = addMonths(todayIso, -12);
  const to = addMonths(todayIso, 12);

  const points: IncomeStreamPointDTO[] = [
    ...retroactive.map((r) => ({
      date: r.paymentDate ?? r.exDate,
      amount: r.income,
      currency: r.currency,
      symbol: r.symbol,
      certainty: "paid" as const,
    })),
    ...announced.map((a) => ({
      date: a.paymentDate ?? a.exDate,
      amount: a.income,
      currency: a.currency,
      symbol: a.symbol,
      certainty: "confirmed" as const,
    })),
    ...projected.map((p) => ({
      date: p.paymentDate ?? p.projectedExDate,
      amount: p.income,
      currency: p.currency,
      symbol: p.symbol,
      certainty: "estimated" as const,
    })),
  ]
    // A zero drawn at zero height is an invisible mark that still costs a DOM
    // node and still answers a hover; drop them rather than draw nothing.
    .filter((pt) => pt.date >= from && pt.date <= to && new Decimal(pt.amount).gt(0))
    .sort((a, b) => a.date.localeCompare(b.date));

  return points.length > MAX_STREAM_POINTS
    ? points.slice(points.length - MAX_STREAM_POINTS)
    : points;
}

export function selectRecentDividends(announced: AnnouncedRow[], todayIso: string): AnnouncedRow[] {
  const from = previousMarketDay(todayIso);
  return announced
    .filter((r) => r.paymentDate !== null && r.paymentDate >= from && r.paymentDate <= todayIso)
    .sort((a, b) => a.paymentDate!.localeCompare(b.paymentDate!))
    .slice(0, 3);
}

/** The current calendar month's monthlyBreakdown row, mapped to received/projected money. */
function selectThisMonth(
  monthlyBreakdown: MonthlyBreakdownRow[],
  currentMonth: string,
): { received: MoneyDTO; projected: MoneyDTO } | null {
  const row = monthlyBreakdown.find((r) => r.month === currentMonth);
  if (!row) return null;
  const projectedTotal = new Decimal(row.retroactive)
    .plus(new Decimal(row.announced))
    .plus(new Decimal(row.projected));
  return {
    received: { amount: new Decimal(row.retroactive).toFixed(2), currency: row.currency },
    projected: { amount: projectedTotal.toFixed(2), currency: row.currency },
  };
}

/** Aggregates the per-holding sector.plain rows into bucket percents (of
 *  total market value), sorted desc. Top 4 buckets plus an "Other" bucket
 *  summing the rest — the diversification view (Task 2) now returns
 *  per-holding rows instead of pre-aggregated breakdowns, so this selector
 *  does the grouping the old service used to do. */
function selectAllocation(
  sectorRows: DimRowDTO[],
  totalMarketValue: string,
): { label: string; percent: number }[] {
  const total = new Decimal(totalMarketValue);
  if (total.isZero()) return [];

  const grouped = new Map<string, Decimal>();
  for (const r of sectorRows) {
    const value = new Decimal(r.marketValue.amount);
    grouped.set(r.bucket, (grouped.get(r.bucket) ?? new Decimal(0)).plus(value));
  }
  const sorted = [...grouped.entries()]
    .map(([label, value]) => ({
      label,
      percent: Number(value.dividedBy(total).times(100).toFixed(2)),
    }))
    .sort((a, b) => b.percent - a.percent);

  const top4 = sorted.slice(0, 4);
  if (sorted.length <= 4) return top4;
  const topSum = top4.reduce((sum, s) => sum + s.percent, 0);
  const otherPercent = Math.max(0, Number((100 - topSum).toFixed(2)));
  return [...top4, { label: "Other", percent: otherPercent }];
}

export function dashboardRoutes(
  db: Database,
  provider: IMarketDataProvider,
  fxRateService?: IFxRateService,
  dividendProviders?: IMarketDataProvider[],
) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const userId = c.get("user").id;
    const deps = { db, provider, fxRateService, dividendProviders };

    // Lazy dividend auto-reconciliation — ≤ once/24h; must never break a read.
    // Must run BEFORE loadPortfolioBook: dividend income now reads its
    // retroactive history straight from the ledger (`transaction` rows of
    // type "dividend"), so a stale/never-reconciled book would silently
    // under-report income here relative to every other route that already
    // reconciles first (portfolio, performance, goal, dividends/income).
    try {
      await reconcileDividends(db, userId);
    } catch (err) {
      console.warn("dividend reconciliation failed", err);
    }

    // One ledger load for the whole dashboard (was 4–5 independent selects +
    // FIFO replays). Builders still run in parallel; they share this book.
    const book = await loadPortfolioBook(db, userId, {
      currency: c.req.query("currency") ?? null,
    });
    const targetCurrency = book.targetCurrency;

    // YTD TWR is embedded here so the overview page does not also hit
    // GET /performance. It requests exactly the primary benchmark
    // (PRIMARY_BENCHMARK_ID) and passes benchmarksCacheOnly: true, which
    // together bound its cost: one comparison series, never fetched upstream
    // inline. A benchmark the store has never fetched at all would otherwise
    // block PersistedPriceProvider unconditionally (it has no `deadline`
    // escape hatch, unlike the "some coverage already" path) -- three
    // sequential upstream calls on a cold self-host, per fetchBenchmarkSeries'
    // symbol-variant fallback. `cacheOnly` skips straight to `relative: null`
    // instead; the page must not hang or fail because a benchmark is cold.
    const [{ body: portfolio, todayChange }, income, diversification, history, perfYtd] =
      await Promise.all([
        buildPortfolioView(deps, userId, { currency: targetCurrency, book }),
        buildDividendIncomeView(deps, userId, { currency: targetCurrency, book }),
        buildDiversificationView(deps, userId, { currency: targetCurrency, book }),
        buildPortfolioHistoryView(deps, userId, { range: "1Y", currency: targetCurrency, book }),
        buildPerformanceView(deps, userId, {
          range: "YTD",
          currency: targetCurrency,
          // One benchmark, not all: the defaults track each other closely
          // enough that a second pin would smudge, and the overview draws no
          // chart to justify the extra series.
          benchmarks: [PRIMARY_BENCHMARK_ID],
          benchmarksCacheOnly: true,
          book,
        }),
      ]);

    const todayIso = new Date().toISOString().slice(0, 10);
    const currentMonth = todayIso.slice(0, 7);

    const upcomingDividends = selectUpcoming(income.announced, income.projected, todayIso);
    const incomeStream = selectIncomeStream(
      income.retroactive,
      income.announced,
      income.projected,
      todayIso,
    );
    const recentDividends = selectRecentDividends(income.announced, todayIso);
    const thisMonth = selectThisMonth(income.summary.monthlyBreakdown, currentMonth);
    const allocation = selectAllocation(
      diversification.dimensions.sector.plain,
      diversification.totals.marketValue.amount,
    );

    const ytdTwr = perfYtd.insufficientData || perfYtd.twr == null ? null : perfYtd.twr;
    // One boolean, not the symbol list: the overview is not where this gets
    // resolved, and a list here would duplicate the performance page's callout
    // without the context (which holding, why) that makes it actionable.
    const ytdTwrIncomplete = perfYtd.historyIncomplete.length > 0;
    // `perfYtd.benchmarks` holds exactly the one series requested above
    // (PRIMARY_BENCHMARK_ID), or none when it never reached back far enough
    // (or `benchmarksCacheOnly` had nothing cached). `relative` carries risk
    // ratios, not a return, so the overview's gap figure needs this pulled out
    // separately rather than the full PerformanceBenchmarkDTO with its
    // `points` array, which the front page has no chart to draw.
    const benchmarkYtdTwr = perfYtd.benchmarks[0]?.twr ?? null;

    // "Total return" now means what this book has made over its whole life:
    // today's unrealised gain, plus every sale it has ever made, plus the
    // income that actually landed after the tax taken off it.
    //
    // It used to mean unrealised gain plus GROSS dividends on the holdings
    // still open — which counted income from positions it held while ignoring
    // every position it had sold, and treated withheld tax as money received.
    // On the reporting book that printed 8,203.66 where the broker said
    // 23,355.74, and matched no figure the holder could find anywhere else.
    //
    // No percentage travels with it. A lifetime gain has no denominator anyone
    // agrees on — today's cost basis, every krone ever put in, and average
    // capital employed differ by more than a factor of two on this book, and
    // the broker's own headline divides by the first, which flatters it. The
    // rate lives on /performance, where it is a time-weighted return over a
    // window the reader chose.
    //
    // Falls back to today's unrealised gain when the valuation series is too
    // short to build — a book bought into this week has no series yet, and it
    // also has nothing sold and nothing paid out, so its whole life IS that
    // gain. Without this the headline blanks on exactly the books whose owners
    // are checking it hourly.
    const unified = portfolio.subtotalsByCurrency.find((s) => s.currency === targetCurrency);
    const lifetimeReturn = perfYtd.lifetime
      ? { amount: perfYtd.lifetime.total }
      : unified
        ? { amount: unified.gainLoss }
        : null;

    return c.json({
      displayCurrency: targetCurrency,
      positions: portfolio.positions,
      subtotalsByCurrency: portfolio.subtotalsByCurrency,
      fxIncomplete: portfolio.fxIncomplete ?? false,
      fxStale: portfolio.fxStale ?? false,
      fxRatesAsOf: portfolio.fxRatesAsOf ?? null,
      todayChange,
      totalReturn: lifetimeReturn,
      ytdTwr,
      ytdTwrIncomplete,
      relative: perfYtd.relative ?? null,
      benchmarkYtdTwr,
      income: {
        projectedTwelveMonth: income.summary.projectedTwelveMonthIncome[0] ?? null,
        trailingTwelveMonth: income.summary.trailingTwelveMonthIncome[0] ?? null,
        thisMonth,
        dividendTaxRate: income.dividendTaxRate,
      },
      incomeStream,
      upcomingDividends,
      recentDividends,
      allocation,
      history,
    });
  });

  return app;
}
