import type { MonthlyBreakdownDTO, ReceivedByYearDTO } from "./types";
import type { CalendarEvent, CalendarStatus } from "./dividend-events";

export interface YearMonthTotal {
  /** 1-12. */
  month: number;
  total: number;
  /** Distinct holdings paying in this month, not the number of payments. */
  payers: number;
  currency: string;
  /** True when the month's events do not share one currency — `total` is
   *  still a real number (the bar needs a height) but is not safe to label. */
  mixedCurrency: boolean;
}

export interface YearProgress {
  received: number;
  expected: number;
  total: number;
  currency: string;
  /** True when the year's months do not share one currency — `total` is
   *  still a real number (the bar needs a height) but is not safe to label. */
  mixedCurrency: boolean;
}

export interface TimelinePoint {
  year: number;
  received: number;
  /** 0 for every year but the current one. */
  projected: number;
  /** The stack's height — what the year's value label reads. Carried here so
   *  the chart labels the total without re-adding the two halves itself. */
  total: number;
  isCurrentYear: boolean;
}

/** `YYYY-MM` for a Date, in LOCAL time — the calendar is a local-time surface
 *  and `toISOString` would shift a payment across a month boundary for anyone
 *  east of UTC. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The span the year picker offers: earliest year money actually arrived,
 *  through next year. Derived, never hardcoded — a constant here would rot. */
export function paymentYearBounds(
  events: CalendarEvent[],
  today: Date,
): { first: number; last: number } {
  const currentYear = today.getFullYear();
  let first = currentYear;
  for (const e of events) {
    // Paid history only. A projection landing next January says nothing about
    // when this portfolio started earning.
    if (e.type !== "paid") continue;
    const year = Number(e.date.slice(0, 4));
    if (Number.isFinite(year) && year < first) first = year;
  }
  return { first, last: currentYear + 1 };
}

/** Twelve rows, always, so a caller can index the year by month rather than
 *  having to reconcile a sparse list against the months that happen to have
 *  payments. */
export function monthlyTotalsForYear(
  events: CalendarEvent[],
  year: number,
  activeStatuses?: Set<CalendarStatus>,
): YearMonthTotal[] {
  const rowsByMonth: Array<Array<{ income: string; currency: string }>> = Array.from(
    { length: 12 },
    () => [],
  );
  const payersByMonth = Array.from({ length: 12 }, () => new Set<string>());

  for (const e of events) {
    if (activeStatuses && !activeStatuses.has(e.type)) continue;
    if (Number(e.date.slice(0, 4)) !== year) continue;
    const index = Number(e.date.slice(5, 7)) - 1;
    if (index < 0 || index > 11) continue;
    rowsByMonth[index]!.push({ income: e.income, currency: e.currency });
    payersByMonth[index]!.add(e.symbol);
  }

  return rowsByMonth.map((rows, i) => {
    const sum = sumIncome(rows);
    // The bar still needs a height even when the label can't be shown, so the
    // numeric total is computed independently of the conflict check — `sum`
    // bails out early on the first mismatched currency and never finishes
    // accumulating.
    const total = rows.reduce((s, r) => s + Number(r.income), 0);
    return {
      month: i + 1,
      total,
      payers: payersByMonth[i]!.size,
      currency: sum?.currency ?? "",
      mixedCurrency: sum === null,
    };
  });
}

/** Zero the series the reader has deselected, leaving the twelve rows and
 *  their currencies intact.
 *
 *  The status filter sits between the chart and the month detail and names its
 *  three options exactly as the chart's three series — so one control that
 *  appears to govern both while moving only one of them is the readability
 *  defect this closes. The legend keeps showing all three; only the data
 *  responds. */
export function filterMonthlyBreakdown(
  rows: MonthlyBreakdownDTO[],
  activeStatuses?: Set<CalendarStatus>,
): MonthlyBreakdownDTO[] {
  if (!activeStatuses) return rows;
  return rows.map((row) => ({
    ...row,
    retroactive: activeStatuses.has("paid") ? row.retroactive : "0",
    announced: activeStatuses.has("announced") ? row.announced : "0",
    projected: activeStatuses.has("projected") ? row.projected : "0",
  }));
}

/** The selected year's income, read from the SAME events the list and the grid
 *  render — not from `monthlyBreakdown`.
 *
 *  Those two are different populations. The API drops rows FX conversion could
 *  not reach out of `monthlyBreakdown` while leaving them in the row arrays,
 *  and only the row arrays are reachable by the status filter. Deriving the
 *  hero from `monthlyBreakdown` therefore left the summary band sitting above a
 *  list that disagreed with it the moment anyone touched a filter — the page's
 *  most common interaction. Reading one population makes the three layers one
 *  quantity by construction rather than by coincidence.
 *
 *  The received/expected split needs no date arithmetic here: `CalendarEvent`
 *  already carries it. `buildCalendarEvents` types a payment `paid` only once
 *  its cash date has arrived, so a retroactive row still awaiting payment
 *  counts as expected — which the month-granularity split over
 *  `MonthlyBreakdownDTO` got wrong. */
export function yearProgressFromEvents(
  events: CalendarEvent[],
  year: number,
  activeStatuses?: Set<CalendarStatus>,
): YearProgress {
  let received = 0;
  let expected = 0;
  const rowsInYear: Array<{ income: string; currency: string }> = [];

  for (const e of events) {
    if (activeStatuses && !activeStatuses.has(e.type)) continue;
    if (!e.date.startsWith(`${year}-`)) continue;
    if (e.type === "paid") received += Number(e.income);
    else expected += Number(e.income);
    rowsInYear.push({ income: e.income, currency: e.currency });
  }

  const sum = sumIncome(rowsInYear);
  // A year with no events of its own must not report an empty currency: the
  // caller formats money with it, and `Intl.NumberFormat(…, { currency: "" })`
  // throws a RangeError. Fall back to any event the payload does carry, and
  // leave it empty only when there is nothing at all — which callers render
  // as "—".
  const currency = sum?.currency || (events.find((e) => e.currency)?.currency ?? "");

  return {
    received,
    expected,
    total: received + expected,
    currency,
    mixedCurrency: sum === null,
  };
}

/** How far through a year's income we are. Months before this one contribute
 *  what was received; this month contributes its received portion too, because
 *  a payment already banked on the 3rd is not "expected".
 *
 *  The `row.month >= current` split is safe because no announced or projected
 *  row can land in a past month: announced rows always have `exDate > today`,
 *  and `packages/core` guarantees a projected ex-date is strictly `> asOf`.
 *  Feeding this function rows that violate that would understate `expected`. */
export function yearProgress(
  monthly: MonthlyBreakdownDTO[],
  year: number,
  today: Date,
): YearProgress {
  const current = monthKey(today);
  let received = 0;
  let expected = 0;
  let currency = "";
  const rowsInYear: Array<{ income: string; currency: string }> = [];

  for (const row of monthly) {
    if (!row.month.startsWith(`${year}-`)) continue;
    if (!currency) currency = row.currency;
    // `retroactive` is money that arrived, whenever in the year it did.
    received += Number(row.retroactive);
    // Announced and projected are both still ahead — but only count them for
    // this month and later. A past month's projection is not "expected"; the
    // real payment landed in `retroactive`, and adding both double-counts it.
    if (row.month >= current) {
      expected += Number(row.announced) + Number(row.projected);
    }
    // The conflict question is about the row's currency, one field per row.
    // `MonthlyBreakdownDTO` has no per-payment granularity to hand `sumIncome`
    // instead, so the row's own three figures stand in for its income.
    rowsInYear.push({
      income: String(Number(row.retroactive) + Number(row.announced) + Number(row.projected)),
      currency: row.currency,
    });
  }

  // A year with no rows of its own must not report an empty currency: the
  // caller formats money with it, and `Intl.NumberFormat(…, { currency: "" })`
  // throws a RangeError. Fall back to any month the payload does carry — the
  // whole breakdown is in one display currency — and leave it empty only when
  // there is nothing at all, which callers render as "—".
  if (!currency) currency = monthly.find((row) => row.currency)?.currency ?? "";

  return {
    received,
    expected,
    total: received + expected,
    currency,
    mixedCurrency: sumIncome(rowsInYear) === null,
  };
}

/** Received per year, plus the current year split into what has arrived and
 *  what is still coming.
 *
 *  It deliberately STOPS at the current year. The projection horizon is twelve
 *  months from today, not to the end of next calendar year, so a next-year
 *  column would be built from a partial year — in August, eight months against
 *  twelve — and would render as a collapse in income rather than as a horizon.
 *  A bar cannot caveat its own height. Next year is reachable through the
 *  /dividends year picker instead, at month granularity, where the projection
 *  running out is visible. */
export function incomeTimeline(
  receivedByYear: ReceivedByYearDTO[],
  monthly: MonthlyBreakdownDTO[],
  today: Date,
): TimelinePoint[] {
  const currentYear = today.getFullYear();
  const years = new Set(
    receivedByYear.map((r) => Number(r.year)).filter((y) => Number.isFinite(y) && y <= currentYear),
  );

  // The API only creates a `receivedByYear` entry once money has actually
  // arrived, so every January — and for any portfolio whose payers have not
  // paid yet this year — the current year is missing from it entirely. Left to
  // that alone the chart would end at last year, the split this chart exists
  // to draw would vanish, and the calendar's progress line ("0 received, X
  // still expected") would have no column to agree with. Add the current year
  // whenever the year has income of any kind; `received` then defaults to 0.
  const currentProgress = yearProgress(monthly, currentYear, today);
  if (currentProgress.total > 0) years.add(currentYear);

  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const isCurrentYear = year === currentYear;
      const progress = yearProgress(monthly, year, today);
      const received = Number(receivedByYear.find((r) => Number(r.year) === year)?.amount ?? "0");
      const projected = isCurrentYear ? progress.expected : 0;
      return { year, received, projected, total: received + projected, isCurrentYear };
    });
}

/** The twelve `YYYY-MM` keys of a calendar year, January first. */
export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/** Days in a calendar year. Used to turn a year's income into a per-day rate,
 *  so a leap year divides by 366 rather than quietly overstating the figure. */
export function daysInYear(year: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 366 : 365;
}

/** Add amounts that share a currency, or return `null` if they do not.
 *
 *  `CalendarEvent.currency` is not uniform: when FX conversion is incomplete
 *  the API leaves unconvertible rows in their native currency while the rest
 *  land in the display currency. Summing across that produces a number that is
 *  wrong in every currency it might be read as, so callers render "—" instead.
 *  A blank currency is missing data, not a second currency, and is added at
 *  face value rather than poisoning the result. */
export function sumIncome(
  items: Array<{ income: string; currency: string }>,
): { total: number; currency: string } | null {
  let total = 0;
  let currency = "";
  for (const item of items) {
    total += Number(item.income);
    if (!item.currency) continue;
    if (!currency) currency = item.currency;
    else if (currency !== item.currency) return null;
  }
  return { total, currency };
}
