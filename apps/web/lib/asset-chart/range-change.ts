/** A point on a chart line; `time` is the ISO day lightweight-charts keys by. */
export interface SeriesPoint {
  time: string;
  value: number;
}

/** One daily close, as the asset endpoint sends it (amount parsed). */
export interface ClosePoint {
  date: string;
  close: number;
}

export type RangeKey = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";

/** How the header names each range: "−€3.35 (−9.80%) past year". */
export const RANGE_PHRASE: Record<RangeKey, string> = {
  "1W": "past week",
  "1M": "past month",
  "3M": "past 3 months",
  YTD: "year to date",
  "1Y": "past year",
  ALL: "all time",
};

export interface RangeChange {
  /** In the series' own unit (currency for prices). */
  abs: number;
  /** Percent, e.g. -9.8. */
  pct: number;
}

/** Below this a move is rounding, not a direction. */
export const FLAT_PCT = 0.005;

/** The last point on or before `date`; null before the first. */
export function valueAtOrBefore(points: SeriesPoint[], date: string): SeriesPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i]!.time <= date) return points[i]!;
  }
  return null;
}

/** Change from the range's first point to `date` (or to the last point). */
export function rangeChange(points: SeriesPoint[], date: string | null = null): RangeChange | null {
  const first = points[0];
  if (!first || first.value === 0) return null;
  const end = date === null ? points[points.length - 1]! : valueAtOrBefore(points, date);
  if (!end) return null;
  const abs = end.value - first.value;
  return { abs, pct: (abs / first.value) * 100 };
}

export type Direction = "up" | "down" | "flat";

export function direction(change: RangeChange | null): Direction {
  if (!change || Math.abs(change.pct) < FLAT_PCT) return "flat";
  return change.pct > 0 ? "up" : "down";
}
