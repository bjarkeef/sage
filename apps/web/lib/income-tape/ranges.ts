import { sameDayLastYear, yearOfDay, yearStartDay } from "./points";
import type { Extent } from "./viewport";

export type RangeKey = "today" | "year" | "ytd" | "all";

/** What a figure sums. "headline" sums the points the API tagged as part of the
 *  overview's headline totals, so Today reads exactly the number the page has
 *  always led with. */
export type Measure =
  { kind: "window"; from: number; to: number } | { kind: "headline"; tag: "forward" | "trailing" };

export interface ResolvedRange {
  key: RangeKey | null;
  label: string;
  dates: [number, number];
  view: [number, number];
  measure: Measure;
  compare: Measure | null;
  compareLabel: string | null;
}

export interface RangeContext {
  todayDay: number;
  year: number;
  extent: Extent;
}

const win = (from: number, to: number): Measure => ({ kind: "window", from, to });

export function resolveRange(key: RangeKey, ctx: RangeContext): ResolvedRange {
  const { todayDay, year, extent } = ctx;
  switch (key) {
    case "today":
      return {
        key,
        label: "Next 12 months",
        dates: [todayDay, todayDay + 365],
        view: [todayDay - 365, todayDay + 365],
        measure: { kind: "headline", tag: "forward" },
        compare: { kind: "headline", tag: "trailing" },
        compareLabel: "last 12 months",
      };
    case "year": {
      const from = yearStartDay(year);
      const to = yearStartDay(year + 1);
      return {
        key,
        label: String(year),
        dates: [from, to],
        view: [from, to],
        measure: win(from, to),
        compare: win(yearStartDay(year - 1), from),
        compareLabel: `all of ${year - 1}`,
      };
    }
    case "ytd": {
      const y = yearOfDay(todayDay);
      const from = yearStartDay(y);
      return {
        key,
        label: "Year to date",
        dates: [from, todayDay + 1],
        view: [from, todayDay + 1],
        measure: win(from, todayDay + 1),
        compare: win(yearStartDay(y - 1), sameDayLastYear(todayDay) + 1),
        compareLabel: `same period in ${y - 1}`,
      };
    }
    case "all":
      return {
        key,
        label: "All time",
        dates: [extent.firstDay, extent.lastDay + 1],
        view: [extent.firstDay, extent.lastDay + 1],
        measure: win(extent.firstDay, extent.lastDay + 1),
        compare: null,
        compareLabel: null,
      };
  }
}

export function inViewRange(window: [number, number]): ResolvedRange {
  const [from, to] = window;
  return {
    key: null,
    label: "In view",
    dates: [from, to],
    view: [from, to],
    measure: win(from, to),
    compare: win(from - 365, to - 365),
    compareLabel: "same window a year earlier",
  };
}

export function yearStepBounds(extent: Extent): { min: number; max: number } {
  return { min: yearOfDay(extent.firstDay), max: yearOfDay(extent.lastDay) };
}
