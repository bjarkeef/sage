import type { DividendHistoryRow } from "@sage/core";

export interface YieldRange {
  /** Gross fractions (0.06 = 6%). The UI applies the tax factor, like every
   *  other yield on the page. */
  low: number;
  high: number;
  /** The asset endpoint's `income.currentYield` (TTM ÷ live price), passed
   *  through so the marker and the strip read one producer. */
  current: number | null;
}

/** Two years of monthly samples; below that a "range" is mostly noise. */
export const MIN_YIELD_SAMPLES = 24;
/** A month-end close older than this is not that month's price. */
const MAX_CLOSE_AGE_DAYS = 7;
const DAY_MS = 86_400_000;

function shift(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Last calendar day of every month whose end falls in [fromIso, toIso]. */
function monthEndsBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let y = Number(fromIso.slice(0, 4));
  let m = Number(fromIso.slice(5, 7));
  for (;;) {
    // Day 0 of the next month (0-based `m`) is the last day of month `m`.
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (end > toIso) break;
    if (end >= fromIso) out.push(end);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Where today's yield sits against the holding's own last five years: at each
 * month-end, trailing-12-month dividends per share ÷ that day's close.
 *
 * - A month-end is sampled only once a full trailing year of dividend history
 *   lies behind it; before that the trailing sum is short, not low.
 * - A month whose trailing dividends are in a different currency from its close
 *   is skipped — a yield across currencies is not a yield.
 * - Null under `MIN_YIELD_SAMPLES` samples, and for a holding that never paid.
 *
 * Pure: `todayIso` is an argument; `closes` ascending.
 */
export function computeYieldRange5y(input: {
  closes: { date: string; close: number; currency: string }[];
  dividends: DividendHistoryRow[];
  todayIso: string;
  currentYield: number | null;
}): YieldRange | null {
  const { closes, todayIso } = input;
  const divs = [...input.dividends].sort((a, b) => a.exDate.localeCompare(b.exDate));
  if (divs.length === 0 || closes.length === 0) return null;

  const firstEx = divs[0]!.exDate;
  const fiveYearsAgo = `${Number(todayIso.slice(0, 4)) - 5}${todayIso.slice(4)}`;
  const samples: number[] = [];
  let ci = -1;

  for (const end of monthEndsBetween(fiveYearsAgo, todayIso)) {
    const windowStart = shift(end, -365); // exclusive
    if (windowStart < firstEx) continue;

    while (ci + 1 < closes.length && closes[ci + 1]!.date <= end) ci++;
    const bar = ci >= 0 ? closes[ci]! : null;
    if (!bar || bar.close <= 0 || bar.date < shift(end, -MAX_CLOSE_AGE_DAYS)) continue;

    const inWindow = divs.filter((d) => d.exDate > windowStart && d.exDate <= end);
    if (inWindow.some((d) => d.currency !== bar.currency)) continue;
    const ttm = inWindow.reduce((s, d) => s + Number(d.amountPerShare), 0);
    samples.push(ttm / bar.close);
  }

  if (samples.length < MIN_YIELD_SAMPLES) return null;
  return {
    low: Number(Math.min(...samples).toFixed(6)),
    high: Number(Math.max(...samples).toFixed(6)),
    current: input.currentYield,
  };
}
