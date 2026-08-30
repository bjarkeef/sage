import { Decimal } from "../money/decimal";
import type { DailyReturn } from "./performance";

/** One date on which both series produced a return. */
export interface ReturnPair {
  date: string;
  portfolio: Decimal;
  benchmark: Decimal;
}

/** Daily returns from a normalized index series, where each value is a level
 *  rather than a return: r_t = level_t / level_{t−1} − 1. Benchmark points
 *  arrive as closes divided by the first close, which is exactly that shape.
 *  A base level ≤ 0 cannot produce a return and is skipped, mirroring the
 *  zero-base restart rule in `computeDailyReturns`. */
export function returnsFromIndex(points: { date: string; value: Decimal }[]): DailyReturn[] {
  const out: DailyReturn[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if (prev.value.lessThanOrEqualTo(0)) continue;
    out.push({ date: curr.date, value: curr.value.dividedBy(prev.value).minus(1) });
  }
  return out;
}

/** Inner join on date. A Europe-heavy portfolio prices days the US benchmark
 *  has no bar for, and vice versa; covariance over misaligned rows is silently
 *  wrong — no error, just a bad number — so only dates present in BOTH series
 *  survive. Output is date-ascending whatever order the inputs arrived in. */
export function pairReturns(portfolio: DailyReturn[], benchmark: DailyReturn[]): ReturnPair[] {
  const byDate = new Map(benchmark.map((r) => [r.date, r.value]));
  const paired: ReturnPair[] = [];
  for (const r of portfolio) {
    const b = byDate.get(r.date);
    if (b !== undefined) paired.push({ date: r.date, portfolio: r.value, benchmark: b });
  }
  paired.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return paired;
}

/** Minimum overlapping market days before beta is reported.
 *
 *  20 is a judgement call, not a derived threshold: low enough that a one-month
 *  range still shows a beta, high enough that a single week of noise does not
 *  produce a confident-looking number. Sage is self-hosted and open source, so
 *  anyone who disagrees should be able to find this and change it — which is
 *  why it is a named constant rather than an inline literal. Callers surface
 *  the suppression rather than hiding it: the API echoes this value in its
 *  response and the UI says which floor it failed. */
export const MIN_PAIRED_DAYS_FOR_BETA = 20;

/** Portfolio beta against the benchmark: cov(p, b) / var(b) over the paired
 *  daily returns. The (n−1) divisor cancels between covariance and variance, so
 *  it is omitted. Doubles are fine for a display-grade statistic.
 *
 *  Null below `MIN_PAIRED_DAYS_FOR_BETA` pairs, and null when the benchmark did
 *  not move over the window: zero variance makes beta undefined, and an honest
 *  dash beats a fabricated number. */
export function beta(paired: ReturnPair[]): Decimal | null {
  if (paired.length < MIN_PAIRED_DAYS_FOR_BETA) return null;
  const n = paired.length;
  const p = paired.map((r) => Number(r.portfolio));
  const b = paired.map((r) => Number(r.benchmark));
  const meanP = p.reduce((a, c) => a + c, 0) / n;
  const meanB = b.reduce((a, c) => a + c, 0) / n;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (p[i]! - meanP) * (b[i]! - meanB);
    varB += (b[i]! - meanB) ** 2;
  }
  if (varB === 0) return null;
  return new Decimal(cov / varB);
}
