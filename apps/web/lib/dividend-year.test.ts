import { describe, it, expect } from "vitest";
import type { CalendarEvent } from "./dividend-events";
import {
  paymentYearBounds,
  monthlyTotalsForYear,
  yearProgress,
  yearProgressFromEvents,
  filterMonthlyBreakdown,
  incomeTimeline,
  monthsOfYear,
  daysInYear,
  sumIncome,
  breakdownFromEvents,
} from "./dividend-year";

// Every fixture is built against an explicit `today`, never `new Date()`.
// A test anchored to a real date rots the moment the calendar moves past it.
const TODAY = new Date(2026, 7, 15); // 15 August 2026, local time

function event(
  date: string,
  type: CalendarEvent["type"],
  symbol: string,
  income: string,
): CalendarEvent {
  return {
    date,
    symbol,
    name: `${symbol} Holdings`,
    income,
    currency: "DKK",
    type,
    amountPerShare: "1.00",
    shares: "10",
    declarationDate: null,
    exDate: date,
    recordDate: null,
    paymentDate: date,
  };
}

describe("paymentYearBounds", () => {
  it("spans the earliest payment through next year", () => {
    const events = [
      event("2023-03-01", "paid", "THAMES", "10"),
      event("2026-08-01", "paid", "THAMES", "10"),
    ];
    expect(paymentYearBounds(events, TODAY)).toEqual({ first: 2023, last: 2027 });
  });

  it("falls back to this year when nothing has been paid yet", () => {
    expect(paymentYearBounds([], TODAY)).toEqual({ first: 2026, last: 2027 });
  });

  // A projection reaching into next year must not become the FIRST year.
  it("runs as far as the forecast does", () => {
    const events = [event("2029-11-02", "projected", "DUOMO", "10")];
    expect(paymentYearBounds(events, TODAY).last).toBe(2029);
  });

  it("takes the earliest bound from paid history, not from a projection", () => {
    const events = [event("2027-01-05", "projected", "DUOMO", "10")];
    expect(paymentYearBounds(events, TODAY).first).toBe(2026);
  });
});

describe("monthlyTotalsForYear", () => {
  const events = [
    event("2026-01-15", "paid", "THAMES", "100"),
    event("2026-01-20", "paid", "THAMES", "50"), // same payer twice in one month
    event("2026-01-25", "paid", "DUOMO", "25"),
    event("2026-03-10", "projected", "THAMES", "70"),
    event("2025-01-10", "paid", "THAMES", "999"), // different year
  ];

  it("returns twelve months whether or not they have payments", () => {
    const rows = monthlyTotalsForYear(events, 2026);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("totals a month and ignores other years", () => {
    const rows = monthlyTotalsForYear(events, 2026);
    expect(rows[0]!.total).toBe(175);
  });

  // Two payments from one holding is one payer. Counting payments would
  // overstate how diversified a month's income is.
  it("counts distinct payers, not payments", () => {
    expect(monthlyTotalsForYear(events, 2026)[0]!.payers).toBe(2);
  });

  it("drops statuses that are filtered out", () => {
    const rows = monthlyTotalsForYear(events, 2026, new Set(["paid"] as const));
    expect(rows[2]!.total).toBe(0);
    expect(rows[2]!.payers).toBe(0);
  });
});

describe("yearProgress", () => {
  const monthly = [
    { month: "2026-06", retroactive: "100", announced: "0", projected: "0", currency: "DKK" },
    { month: "2026-08", retroactive: "40", announced: "10", projected: "0", currency: "DKK" },
    { month: "2026-11", retroactive: "0", announced: "0", projected: "60", currency: "DKK" },
    { month: "2025-06", retroactive: "500", announced: "0", projected: "0", currency: "DKK" },
  ];

  it("splits the year at today into received and still expected", () => {
    // June is past: 100 received. August is the current month, so its
    // retroactive 40 counts as received and its announced 10 as expected.
    // November is ahead: 60 expected.
    const p = yearProgress(monthly, 2026, TODAY);
    expect(p.received).toBe(140);
    expect(p.expected).toBe(70);
    expect(p.total).toBe(210);
    expect(p.currency).toBe("DKK");
  });

  it("ignores other years", () => {
    expect(yearProgress(monthly, 2026, TODAY).received).not.toBe(640);
  });

  it("reports zeroes for a year with no rows", () => {
    const p = yearProgress(monthly, 2020, TODAY);
    expect(p).toMatchObject({ received: 0, expected: 0, total: 0 });
  });

  // An empty currency is not a harmless blank: the caller formats money with
  // it, and Intl.NumberFormat throws a RangeError on "". A portfolio whose
  // last payment predates this year hits exactly this.
  it("falls back to a currency the payload does carry for a year with no rows", () => {
    expect(yearProgress(monthly, 2020, TODAY).currency).toBe("DKK");
  });

  // Nothing to fall back TO is still possible — first run, or an FX outage
  // that filtered every row out. The empty string is the component's cue to
  // render "—" rather than format anything.
  it("reports an empty currency only when there is no income data at all", () => {
    expect(yearProgress([], 2026, TODAY)).toEqual({
      received: 0,
      expected: 0,
      total: 0,
      currency: "",
      mixedCurrency: false,
    });
  });
});

describe("incomeTimeline", () => {
  const received = [
    { year: "2024", amount: "1000", currency: "DKK" },
    { year: "2025", amount: "1200", currency: "DKK" },
    { year: "2026", amount: "140", currency: "DKK" },
  ];
  const monthly = [
    { month: "2026-06", retroactive: "100", announced: "0", projected: "0", currency: "DKK" },
    { month: "2026-08", retroactive: "40", announced: "10", projected: "0", currency: "DKK" },
    { month: "2026-11", retroactive: "0", announced: "0", projected: "60", currency: "DKK" },
    { month: "2027-01", retroactive: "0", announced: "0", projected: "300", currency: "DKK" },
  ];

  it("carries past years through as received with nothing projected", () => {
    const series = incomeTimeline(received, monthly, TODAY);
    expect(series[0]).toMatchObject({
      year: 2024,
      received: 1000,
      projected: 0,
      isCurrentYear: false,
    });
  });

  it("splits the current year into received and projected", () => {
    const series = incomeTimeline(received, monthly, TODAY);
    const current = series.find((p) => p.year === 2026)!;
    expect(current).toMatchObject({ received: 140, projected: 70, isCurrentYear: true });
  });

  // THE failure this chart exists to avoid. The projection reaches twelve
  // months from TODAY, so next year is covered only to August. A 2027 column
  // would show eight months against twelve and read as an income collapse.
  it("stops at the current year even when projections reach into the next one", () => {
    const series = incomeTimeline(received, monthly, TODAY);
    expect(series.map((p) => p.year)).toEqual([2024, 2025, 2026]);
  });

  it("returns an empty series when nothing has ever been received", () => {
    expect(incomeTimeline([], [], TODAY)).toEqual([]);
  });

  // The API only writes a receivedByYear entry once a payment has actually
  // landed, so every January the current year is absent from it. Driving the
  // year set off receivedByYear alone dropped the current-year column
  // entirely — the one thing this chart exists to draw — and left the
  // calendar's progress line with nothing to agree with.
  it("draws the current year before its first payment arrives", () => {
    const pastOnly = [
      { year: "2024", amount: "1000", currency: "DKK" },
      { year: "2025", amount: "1200", currency: "DKK" },
    ];
    // Everything this year is still ahead: nothing retroactive, one announced
    // payment in the current month and one projected later in the year. Both
    // months are derived from TODAY, never written as literals.
    const currentYear = TODAY.getFullYear();
    /** A month of TODAY's own year, `offset` months on but never past December
     *  — a row that rolled into next year would test something else. */
    const monthOf = (offset: number) =>
      `${currentYear}-${String(Math.min(12, TODAY.getMonth() + 1 + offset)).padStart(2, "0")}`;
    const nothingReceivedYet = [
      { month: monthOf(0), retroactive: "0", announced: "25", projected: "0", currency: "DKK" },
      { month: monthOf(2), retroactive: "0", announced: "0", projected: "45", currency: "DKK" },
    ];

    const series = incomeTimeline(pastOnly, nothingReceivedYet, TODAY);

    expect(series.map((p) => p.year)).toEqual([2024, 2025, currentYear]);
    expect(series.at(-1)).toMatchObject({
      year: currentYear,
      received: 0,
      projected: 70,
      isCurrentYear: true,
    });
  });

  // The horizon rule still holds when the current year is added this way: a
  // projection reaching into next year must not create a next-year column.
  it("still refuses to draw next year when only projections reach it", () => {
    const series = incomeTimeline([], monthly, TODAY);
    expect(series.map((p) => p.year)).toEqual([TODAY.getFullYear()]);
  });
});

// The calendar page's progress line and the analytics timeline's current-year
// column are the same quantity rendered in two places. The failure mode is
// them disagreeing after someone "fixes" one of them.
describe("the two current-year figures agree", () => {
  const monthly = [
    { month: "2026-06", retroactive: "100", announced: "0", projected: "0", currency: "DKK" },
    { month: "2026-08", retroactive: "40", announced: "10", projected: "0", currency: "DKK" },
    { month: "2026-11", retroactive: "0", announced: "0", projected: "60", currency: "DKK" },
  ];
  const received = [{ year: "2026", amount: "140", currency: "DKK" }];

  it("the timeline's current year equals the progress line's split", () => {
    const progress = yearProgress(monthly, 2026, TODAY);
    const current = incomeTimeline(received, monthly, TODAY).find((p) => p.isCurrentYear)!;
    expect(current.received).toBe(progress.received);
    expect(current.projected).toBe(progress.expected);
    expect(current.received + current.projected).toBe(progress.total);
    // The bar's own value label reads `total`, so it has to be the same figure
    // the progress line calls "for the year" — not a third number.
    expect(current.total).toBe(progress.total);
  });
});

describe("monthsOfYear", () => {
  it("returns twelve YYYY-MM keys starting at January", () => {
    expect(monthsOfYear(2026)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
  });
});

describe("daysInYear", () => {
  it("counts 365 in a common year and 366 in a leap year", () => {
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2028)).toBe(366);
  });

  it("treats a century year divisible by 400 as a leap year", () => {
    // 1900 was not a leap year; 2000 was. A naive `% 4` check gets this wrong.
    expect(daysInYear(1900)).toBe(365);
    expect(daysInYear(2000)).toBe(366);
  });
});

describe("sumIncome", () => {
  it("adds amounts that share a currency", () => {
    // toBeCloseTo, not toEqual: 4.05 + 5.42 lands on 9.469999999999999 in
    // IEEE 754, one ULP off 9.47 — see the "float-safe decimal fixtures"
    // hazard noted elsewhere in this repo. The digits are right; the bits
    // aren't, and exact equality on the sum would fail for a reason that has
    // nothing to do with sumIncome's correctness.
    const result = sumIncome([
      { income: "4.05", currency: "USD" },
      { income: "5.42", currency: "USD" },
    ]);
    expect(result?.total).toBeCloseTo(9.47);
    expect(result?.currency).toBe("USD");
  });

  it("refuses to add across currencies", () => {
    // An FX-incomplete payload leaves some rows in their native currency.
    // Adding 100 DKK to 10 USD produces a figure that is wrong in both, so the
    // caller gets null and renders a dash instead of a lie.
    expect(
      sumIncome([
        { income: "100.00", currency: "DKK" },
        { income: "10.00", currency: "USD" },
      ]),
    ).toBeNull();
  });

  it("returns a zero total and no currency for an empty list", () => {
    expect(sumIncome([])).toEqual({ total: 0, currency: "" });
  });

  it("ignores rows with no currency rather than treating '' as a second one", () => {
    // A blank currency is missing data, not a different currency.
    expect(
      sumIncome([
        { income: "4.05", currency: "USD" },
        { income: "1.00", currency: "" },
      ]),
    ).toEqual({ total: 5.05, currency: "USD" });
  });
});

describe("monthlyTotalsForYear currency conflicts", () => {
  it("flags a month whose events do not share a currency", () => {
    const mixedFebruary = [
      { ...event("2026-02-05", "paid", "THAMES", "100"), currency: "DKK" },
      { ...event("2026-02-18", "paid", "DUOMO", "10"), currency: "USD" },
    ];
    const rows = monthlyTotalsForYear(mixedFebruary, 2026);
    expect(rows[1]!.mixedCurrency).toBe(true);
    // A total cannot be computed honestly, but the bar still needs a height.
    expect(rows[1]!.total).toBe(110);
  });

  it("does not flag a month whose events agree on currency", () => {
    const agreeingJanuary = [
      { ...event("2026-01-05", "paid", "THAMES", "100"), currency: "DKK" },
      { ...event("2026-01-18", "paid", "DUOMO", "10"), currency: "DKK" },
    ];
    const rows = monthlyTotalsForYear(agreeingJanuary, 2026);
    expect(rows[0]!.mixedCurrency).toBe(false);
    expect(rows[0]!.total).toBe(110);
  });
});

describe("yearProgressFromEvents", () => {
  // Deliberately the same events the list and the grid render, so the summary
  // band cannot describe a different population from the rows beneath it.
  const events = [
    event("2026-03-10", "paid", "THAMES", "100"),
    event("2026-09-20", "announced", "DUOMO", "40"),
    event("2026-11-05", "projected", "NORDA-B", "60"),
    event("2025-06-01", "paid", "THAMES", "500"),
  ];

  it("splits paid from still-expected and totals only the given year", () => {
    const p = yearProgressFromEvents(events, 2026);
    expect(p.received).toBe(100);
    expect(p.expected).toBe(100);
    expect(p.total).toBe(200);
    expect(p.currency).toBe("DKK");
  });

  // The invariant the whole rework rests on: the band answers the same filter
  // the list and the grid do.
  it("drops a deselected status from received, expected and the total alike", () => {
    const p = yearProgressFromEvents(events, 2026, new Set(["paid", "announced"] as const));
    expect(p.received).toBe(100);
    expect(p.expected).toBe(40);
    expect(p.total).toBe(140);
  });

  // `buildCalendarEvents` types a retroactive row whose cash date is still
  // ahead as `announced`, so no date arithmetic is needed here — and the
  // month-granularity split over MonthlyBreakdownDTO, which counted such a row
  // as received, was wrong about it.
  it("counts an unpaid retroactive row as expected, not received", () => {
    const p = yearProgressFromEvents([event("2026-12-31", "announced", "THAMES", "25")], 2026);
    expect(p.received).toBe(0);
    expect(p.expected).toBe(25);
  });

  it("falls back to a currency the events do carry for a year with none", () => {
    expect(yearProgressFromEvents(events, 2020).currency).toBe("DKK");
  });

  it("reports an empty currency only when there are no events at all", () => {
    expect(yearProgressFromEvents([], 2026)).toEqual({
      received: 0,
      expected: 0,
      total: 0,
      currency: "",
      mixedCurrency: false,
    });
  });

  it("withholds the total when the year's events do not share a currency", () => {
    const mixed = [
      event("2026-03-10", "paid", "THAMES", "100"),
      { ...event("2026-04-10", "paid", "DUOMO", "50"), currency: "USD" },
    ];
    const p = yearProgressFromEvents(mixed, 2026);
    expect(p.mixedCurrency).toBe(true);
    // The figures still exist — only the label is withheld by the caller.
    expect(p.total).toBe(150);
  });
});

describe("filterMonthlyBreakdown", () => {
  const rows = [
    { month: "2026-06", retroactive: "47", announced: "20", projected: "8", currency: "USD" },
  ];

  it("zeroes only the deselected series, leaving month and currency intact", () => {
    const [row] = filterMonthlyBreakdown(rows, new Set(["paid"] as const));
    expect(row).toEqual({
      month: "2026-06",
      retroactive: "47",
      announced: "0",
      projected: "0",
      currency: "USD",
    });
  });

  it("passes the rows through untouched when no filter is given", () => {
    expect(filterMonthlyBreakdown(rows)).toBe(rows);
  });
});

describe("yearProgress currency conflicts", () => {
  const mixed = [
    { month: "2026-06", retroactive: "100", announced: "0", projected: "0", currency: "DKK" },
    { month: "2026-08", retroactive: "40", announced: "10", projected: "0", currency: "USD" },
  ];

  it("flags a year whose months do not share a currency", () => {
    expect(yearProgress(mixed, 2026, TODAY).mixedCurrency).toBe(true);
  });

  it("still reports received/expected numerically when currencies conflict", () => {
    // The label is withheld; the bars still need a height.
    const p = yearProgress(mixed, 2026, TODAY);
    expect(p.received).toBe(140);
    expect(p.expected).toBe(10);
  });

  it("does not flag a year whose months agree on currency", () => {
    const uniform = [
      { month: "2026-06", retroactive: "100", announced: "0", projected: "0", currency: "DKK" },
      { month: "2026-08", retroactive: "40", announced: "10", projected: "0", currency: "DKK" },
    ];
    expect(yearProgress(uniform, 2026, TODAY).mixedCurrency).toBe(false);
  });
});

describe("breakdownFromEvents", () => {
  it("sums each month by status and skips other years", () => {
    const events = [
      event("2028-01-15", "paid", "THAMES", "100"),
      event("2028-01-20", "announced", "DUOMO", "25"),
      event("2028-03-10", "projected", "THAMES", "70"),
      event("2028-03-11", "projected", "DUOMO", "5.5"),
      event("2027-03-10", "projected", "THAMES", "999"),
    ];
    expect(breakdownFromEvents(events, 2028)).toEqual([
      {
        month: "2028-01",
        retroactive: "100.00",
        announced: "25.00",
        projected: "0.00",
        currency: "DKK",
      },
      {
        month: "2028-03",
        retroactive: "0.00",
        announced: "0.00",
        projected: "75.50",
        currency: "DKK",
      },
    ]);
  });

  it("names no currency for a month whose rows disagree", () => {
    const events = [
      event("2028-05-01", "projected", "THAMES", "10"),
      { ...event("2028-05-02", "projected", "DUOMO", "10"), currency: "USD" },
    ];
    expect(breakdownFromEvents(events, 2028)[0]!.currency).toBe("");
  });
});
