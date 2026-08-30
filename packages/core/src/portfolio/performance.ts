import { Decimal } from "../money/decimal";

/** One day of the valuation series: end-of-day market value and cumulative
 *  net invested, both already converted to the display currency. */
export interface ValuationPoint {
  date: string; // "YYYY-MM-DD"
  marketValue: Decimal;
  invested: Decimal;
  /** Cumulative EXTERNAL FLOW, when it differs from cost basis. Optional
   *  because for most series the two coincide — money enters the portfolio at
   *  the price it was bought at, so a flow and its cost are the same number.
   *
   *  They diverge when a holding joins the series after the window opened:
   *  patchy bar history, a listing with no early data, or a window that opens
   *  on a market holiday (which a custom holding, marked every calendar day,
   *  can price when no exchange can). Such a holding arrives carrying its whole
   *  unrealised gain, and netting only its ORIGINAL COST would book that gain
   *  as a single day's return — a position bought in 2023 could produce a
   *  +450% Tuesday. Economically it is a transfer-in at market: the gain
   *  happened, but not inside the measured window.
   *
   *  Producers that can tell the difference set this; `computeDailyReturns`
   *  prefers it and falls back to `invested`. `invested` stays cost basis, for
   *  the invested line and for XIRR, which want the real money in. */
  flowBasis?: Decimal;
}

/** The series a flow should be measured against: explicit external flow when
 *  the producer supplied one, cost basis otherwise. */
function flowOf(point: ValuationPoint): Decimal {
  return point.flowBasis ?? point.invested;
}

export interface DailyReturn {
  date: string;
  value: Decimal; // r_t as a decimal (0.01 = +1%)
}

/** Daily chain-link returns with end-of-day flow convention:
 *  r_t = (MV_t + D_t − F_t) / MV_{t−1} − 1, where F_t is the day's net
 *  external flow (delta of net invested: buys +, sale proceeds −) and D_t is
 *  dividend income folded into the first valuation date ≥ its pay date.
 *  Dividends at or before the anchor point predate the first measurable
 *  period and are excluded (mirrors the XIRR first-day rule). Pairs whose
 *  base MV is ≤ 0 are skipped — the chain restarts on the next non-zero base
 *  rather than dividing by zero.
 *
 *  A computed r ≤ −1 is impossible for a long-only book (you cannot lose more
 *  than everything) and always signals a data artifact — a mispriced bar or a
 *  flow with no matching valuation. Such pairs are skipped (never compounded,
 *  which would poison the whole chain) and reported via `anomalies`. Zero-base
 *  restarts above are NOT counted as anomalies. */
export function computeDailyReturns(
  points: ValuationPoint[],
  dividendsByDate: Map<string, Decimal> = new Map(),
): { returns: DailyReturn[]; anomalies: number } {
  if (points.length < 2) return { returns: [], anomalies: 0 };

  const dates = points.map((p) => p.date);
  const incomeAt = new Map<string, Decimal>();
  for (const [payDate, amount] of dividendsByDate) {
    const i = firstIndexAtOrAfter(dates, payDate);
    if (i <= 0 || i >= dates.length) continue;
    const key = dates[i]!;
    incomeAt.set(key, (incomeAt.get(key) ?? new Decimal(0)).plus(amount));
  }

  const returns: DailyReturn[] = [];
  let anomalies = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if (prev.marketValue.lessThanOrEqualTo(0)) continue;
    const flow = flowOf(curr).minus(flowOf(prev));
    const income = incomeAt.get(curr.date) ?? new Decimal(0);
    const r = curr.marketValue.plus(income).minus(flow).dividedBy(prev.marketValue).minus(1);
    if (r.lessThanOrEqualTo(-1)) {
      anomalies += 1;
      continue;
    }
    returns.push({ date: curr.date, value: r });
  }
  return { returns, anomalies };
}

/** Smallest index with dates[i] >= target; dates.length when none.
 *  Requires dates sorted ascending — computeDailyReturns' points contract. */
function firstIndexAtOrAfter(dates: string[], target: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Geometrically chained cumulative return; 0 for an empty list (callers
 *  that want null-on-empty guard before calling). */
export function chainedTWR(returns: DailyReturn[]): Decimal {
  let acc = new Decimal(1);
  for (const r of returns) acc = acc.times(r.value.plus(1));
  return acc.minus(1);
}

/** (1+rate)^(365/windowDays) − 1; null when the base is non-positive
 *  (a −100% period has no meaningful annualization). */
export function annualize(rate: Decimal, windowDays: number): Decimal | null {
  const base = rate.plus(1);
  if (base.lessThanOrEqualTo(0) || windowDays <= 0) return null;
  return base.pow(new Decimal(365).dividedBy(windowDays)).minus(1);
}

/** Flow-neutral growth index: starts at 1 on the anchor date and compounds
 *  each daily return. This — not raw market value — is what drawdown and
 *  charting read, so deposits never fake rallies. */
export function growthIndex(
  returns: DailyReturn[],
  anchorDate: string,
): { date: string; value: Decimal }[] {
  const index = [{ date: anchorDate, value: new Decimal(1) }];
  let acc = new Decimal(1);
  for (const r of returns) {
    acc = acc.times(r.value.plus(1));
    index.push({ date: r.date, value: acc });
  }
  return index;
}

export interface Cashflow {
  date: string; // "YYYY-MM-DD"
  amount: Decimal; // negative = money in (buys), positive = money out / value
}

/** XIRR by bisection on the annual rate over (−0.9999, 10). The solver runs
 *  in doubles — a return figure needs no 34-digit precision and the bracket
 *  search is far simpler this way; the result converts back to Decimal.
 *  Returns null when the bracket has no sign change or inputs are trivial:
 *  an honest dash beats a fabricated number. */
export function xirr(cashflows: Cashflow[]): Decimal | null {
  if (cashflows.length < 2) return null;
  const sorted = [...cashflows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const t0 = Date.parse(`${sorted[0]!.date}T00:00:00Z`);
  const years = sorted.map((cf) => (Date.parse(`${cf.date}T00:00:00Z`) - t0) / (365 * 86_400_000));
  const amounts = sorted.map((cf) => Number(cf.amount));
  const f = (x: number): number =>
    amounts.reduce((sum, amount, i) => sum + amount * Math.pow(1 + x, -years[i]!), 0);

  let lo = -0.9999;
  let hi = 10;
  let flo = f(lo);
  const fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (Math.abs(fmid) < 1e-8) return new Decimal(mid);
    if (flo * fmid <= 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return new Decimal((lo + hi) / 2);
}

/** Annualized sample standard deviation of daily returns (×√252).
 *  Doubles are fine for display-grade statistics. Null under two returns. */
export function volatility(returns: DailyReturn[]): Decimal | null {
  if (returns.length < 2) return null;
  const values = returns.map((r) => Number(r.value));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return new Decimal(Math.sqrt(variance) * Math.sqrt(252));
}

/** Largest peak-to-trough decline of the growth index, as a positive decimal. */
export function maxDrawdown(index: { date: string; value: Decimal }[]): Decimal {
  let peak = new Decimal(0);
  let worst = new Decimal(0);
  for (const p of index) {
    if (p.value.greaterThan(peak)) peak = p.value;
    if (peak.greaterThan(0)) {
      const dd = peak.minus(p.value).dividedBy(peak);
      if (dd.greaterThan(worst)) worst = dd;
    }
  }
  return worst;
}

export function bestWorstDay(
  returns: DailyReturn[],
): { best: DailyReturn; worst: DailyReturn } | null {
  if (returns.length === 0) return null;
  let best = returns[0]!;
  let worst = returns[0]!;
  for (const r of returns) {
    if (r.value.greaterThan(best.value)) best = r;
    if (r.value.lessThan(worst.value)) worst = r;
  }
  return { best, worst };
}
