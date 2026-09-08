import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ForwardPayments,
  ForwardTooltip,
  buildForwardChartData,
  forwardBarLabel,
  labelledMonthIndices,
  capSegment,
  monthTick,
  type MonthDatum,
} from "./forward-payments";
import type {
  AnnouncedDividendDTO,
  ProjectedIncomeRowDTO,
  RetroactiveIncomeRowDTO,
} from "../../lib/types";

/** Twelve consecutive months starting `2026-07`, matching the shape
 *  `buildForwardChartData` returns. `overrides` patches individual months by
 *  index so a test only has to state what it cares about. */
function twelveMonthData(overrides: Record<number, Partial<MonthDatum>> = {}): MonthDatum[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(2026, 6 + i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const base: MonthDatum = {
      month,
      paid: 0,
      confirmed: 0,
      estimated: 0,
      total: 0,
      mixedCurrency: false,
      dateEstimated: false,
    };
    return { ...base, ...overrides[i] };
  });
}

const announced: AnnouncedDividendDTO[] = [
  {
    symbol: "O",
    name: "Realty Income",
    declarationDate: null,
    exDate: "2026-08-01",
    recordDate: null,
    paymentDate: "2026-08-14",
    paymentDateEstimated: false,
    amountPerShare: "0.27",
    shares: "10",
    income: "2.70",
    currency: "USD",
  },
];
const projected: ProjectedIncomeRowDTO[] = [
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    projectedExDate: "2026-11-10",
    paymentDate: "2026-11-15",
    paymentDateEstimated: true,
    confidence: "high",
    amountPerShare: "0.25",
    shares: "10",
    income: "2.50",
    currency: "USD",
  },
];

describe("ForwardPayments", () => {
  it("renders the card title and the certainty legend", () => {
    render(
      <ForwardPayments
        retroactive={[]}
        announced={announced}
        projected={projected}
        currentMonth="2026-07"
        currency="USD"
      />,
    );
    expect(screen.getByText("Next 12 months")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("renders an empty state when there are no forward payments", () => {
    render(
      <ForwardPayments
        retroactive={[]}
        announced={[]}
        projected={[]}
        currentMonth="2026-07"
        currency="USD"
      />,
    );
    expect(screen.getByText("Next 12 months")).toBeInTheDocument();
    expect(screen.getByText("No forward payments yet")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  });

  it("treats trailing-window paid rows outside the forward window as empty", () => {
    // A dividend paid months ago is not a forward payment — with nothing ahead,
    // the card should show its empty state, not a stale bar.
    const retroactive: RetroactiveIncomeRowDTO[] = [
      {
        symbol: "KO",
        name: "Coca-Cola",
        exDate: "2026-01-05",
        paymentDate: "2026-01-15",
        paymentDateEstimated: false,
        amountPerShare: "0.46",
        sharesHeld: "10",
        income: "4.60",
        currency: "USD",
      },
    ];
    render(
      <ForwardPayments
        retroactive={retroactive}
        announced={[]}
        projected={[]}
        currentMonth="2026-07"
        currency="USD"
      />,
    );
    expect(screen.getByText("No forward payments yet")).toBeInTheDocument();
  });
});

// Recharts never lays out its SVG against jsdom's zero-size container (the
// stderr "width(0) and height(0)" warning elsewhere in this suite), so
// <Bar>/<LabelList>/<Tooltip content> never actually mount through
// <ForwardPayments> in a test. The aggregation and the "—" decision are
// pulled out as plain functions specifically so this behavior is testable
// without needing a real layout.
describe("buildForwardChartData currency conflicts", () => {
  it("flags a month whose forward payments do not share a currency", () => {
    const retroactive: RetroactiveIncomeRowDTO[] = [
      {
        symbol: "THAMES.L",
        name: "Thames Holdings",
        exDate: "2026-08-01",
        paymentDate: "2026-08-14",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        sharesHeld: "100",
        income: "100.00",
        currency: "DKK",
      },
    ];
    const announcedMixed: AnnouncedDividendDTO[] = [
      {
        symbol: "O",
        name: "Realty Income",
        declarationDate: null,
        exDate: "2026-08-01",
        recordDate: null,
        paymentDate: "2026-08-20",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        shares: "10",
        income: "10.00",
        currency: "USD",
      },
    ];
    const { chartData } = buildForwardChartData(retroactive, announcedMixed, [], "2026-08");
    const august = chartData.find((d) => d.month === "2026-08")!;
    expect(august.mixedCurrency).toBe(true);
    // A total cannot be computed honestly, but the bar still needs a height.
    expect(august.total).toBe(110);
    // Every other month, untouched by the conflict, stays unflagged.
    expect(chartData.find((d) => d.month === "2026-09")!.mixedCurrency).toBe(false);
  });

  it("does not flag a month whose forward payments agree on currency", () => {
    const announcedSame: AnnouncedDividendDTO[] = [
      {
        symbol: "O",
        name: "Realty Income",
        declarationDate: null,
        exDate: "2026-08-01",
        recordDate: null,
        paymentDate: "2026-08-14",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        shares: "10",
        income: "10.00",
        currency: "USD",
      },
      {
        symbol: "MSFT",
        name: "Microsoft",
        declarationDate: null,
        exDate: "2026-08-01",
        recordDate: null,
        paymentDate: "2026-08-20",
        paymentDateEstimated: false,
        amountPerShare: "0.75",
        shares: "20",
        income: "15.00",
        currency: "USD",
      },
    ];
    const { chartData } = buildForwardChartData([], announcedSame, [], "2026-08");
    const august = chartData.find((d) => d.month === "2026-08")!;
    expect(august.mixedCurrency).toBe(false);
    expect(august.total).toBe(25);
  });

  it("suppresses the reference-line average when the 12-month window is not currency-uniform", () => {
    const retroactive: RetroactiveIncomeRowDTO[] = [
      {
        symbol: "THAMES.L",
        name: "Thames Holdings",
        exDate: "2026-08-01",
        paymentDate: "2026-08-14",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        sharesHeld: "100",
        income: "100.00",
        currency: "DKK",
      },
    ];
    const announcedOtherMonth: AnnouncedDividendDTO[] = [
      {
        symbol: "O",
        name: "Realty Income",
        declarationDate: null,
        exDate: "2026-11-01",
        recordDate: null,
        paymentDate: "2026-11-14",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        shares: "10",
        income: "10.00",
        currency: "USD",
      },
    ];
    // Neither month individually mixes currencies — the conflict only shows
    // up when the whole window is summed for the average.
    const { chartData, avg } = buildForwardChartData(
      retroactive,
      announcedOtherMonth,
      [],
      "2026-08",
    );
    expect(chartData.find((d) => d.month === "2026-08")!.mixedCurrency).toBe(false);
    expect(chartData.find((d) => d.month === "2026-11")!.mixedCurrency).toBe(false);
    expect(avg).toBeNull();
  });

  it("computes the reference-line average when the window agrees on currency", () => {
    const retroactive: RetroactiveIncomeRowDTO[] = [
      {
        symbol: "O",
        name: "Realty Income",
        exDate: "2026-08-01",
        paymentDate: "2026-08-14",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        sharesHeld: "10",
        income: "12.00",
        currency: "USD",
      },
    ];
    const { avg } = buildForwardChartData(retroactive, [], [], "2026-08");
    expect(avg).toBeCloseTo(1); // 12.00 spread over the 12-month window
  });
});

describe("forwardBarLabel", () => {
  it("shows nothing for an empty month", () => {
    expect(
      forwardBarLabel({
        month: "2026-08",
        paid: 0,
        confirmed: 0,
        estimated: 0,
        total: 0,
        mixedCurrency: false,
        dateEstimated: false,
      }),
    ).toBeNull();
  });

  it("shows a dash instead of a summed figure for a mixed-currency month", () => {
    expect(
      forwardBarLabel({
        month: "2026-08",
        paid: 100,
        confirmed: 10,
        estimated: 0,
        total: 110,
        mixedCurrency: true,
        dateEstimated: false,
      }),
    ).toBe("—");
  });

  it("shows the rounded total for a currency-agreeing month", () => {
    expect(
      forwardBarLabel({
        month: "2026-08",
        paid: 25,
        confirmed: 0,
        estimated: 0,
        total: 25,
        mixedCurrency: false,
        dateEstimated: false,
      }),
    ).toBe("25");
  });
});

describe("ForwardTooltip", () => {
  const holdingsByMonth = new Map();

  it("shows a dash instead of a month total that mixes currencies, and hides the certainty breakdown", () => {
    const byMonth = new Map([
      [
        "2026-08",
        {
          month: "2026-08",
          paid: 100,
          confirmed: 10,
          estimated: 0,
          total: 110,
          mixedCurrency: true,
          dateEstimated: false,
        },
      ],
    ]);
    render(
      <ForwardTooltip
        active
        label="2026-08"
        byMonth={byMonth}
        holdingsByMonth={holdingsByMonth}
        currency="USD"
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  });

  it("formats the total normally for a currency-agreeing month", () => {
    const byMonth = new Map([
      [
        "2026-08",
        {
          month: "2026-08",
          paid: 15,
          confirmed: 10,
          estimated: 0,
          total: 25,
          mixedCurrency: false,
          dateEstimated: false,
        },
      ],
    ]);
    render(
      <ForwardTooltip
        active
        label="2026-08"
        byMonth={byMonth}
        holdingsByMonth={holdingsByMonth}
        currency="USD"
      />,
    );
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("$15.00")).toBeInTheDocument();
  });

  // One popover suppressing the honest aggregate while keeping mislabelled
  // rows is worse than either alone: the withheld total tells the reader the
  // month mixes currencies, and the rows underneath then read a 100 DKK
  // payment out as "$100.00".
  it("labels each holding row in the currency it actually paid in", () => {
    const dkkRow: RetroactiveIncomeRowDTO[] = [
      {
        symbol: "THAMES.L",
        name: "Thames Holdings",
        exDate: "2026-08-01",
        paymentDate: "2026-08-14",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        sharesHeld: "100",
        income: "100.00",
        currency: "DKK",
      },
    ];
    const { byMonth, holdingsByMonth } = buildForwardChartData(dkkRow, announced, [], "2026-08");

    render(
      <ForwardTooltip
        active
        label="2026-08"
        byMonth={byMonth}
        holdingsByMonth={holdingsByMonth}
        currency="USD"
      />,
    );

    // The aggregate is still withheld — the month does mix currencies.
    expect(screen.getByText("—")).toBeInTheDocument();
    // Each row carries its own currency rather than the card's display one.
    expect(screen.getByText(/DKK/)).toBeInTheDocument();
    expect(screen.queryByText("$100.00")).not.toBeInTheDocument();
    // …and the USD holding is still USD.
    expect(screen.getByText("$2.70")).toBeInTheDocument();
  });

  it("keeps one holding's two currencies as two rows rather than adding them", () => {
    const twoCurrencies: RetroactiveIncomeRowDTO[] = [
      {
        symbol: "THAMES.L",
        name: "Thames Holdings",
        exDate: "2026-08-01",
        paymentDate: "2026-08-14",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        sharesHeld: "100",
        income: "100.00",
        currency: "DKK",
      },
      {
        symbol: "THAMES.L",
        name: "Thames Holdings",
        exDate: "2026-08-15",
        paymentDate: "2026-08-28",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        sharesHeld: "10",
        income: "10.00",
        currency: "USD",
      },
    ];
    const { holdingsByMonth } = buildForwardChartData(twoCurrencies, [], [], "2026-08");
    const rows = holdingsByMonth.get("2026-08")!;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.currency).sort()).toEqual(["DKK", "USD"]);
    // 110 would be the sum of two currencies — the number this guards against.
    expect(rows.map((r) => r.income).sort((a, b) => a - b)).toEqual([10, 100]);
  });
});

describe("labelledMonthIndices", () => {
  it("labels only the peak, the trough and the current month", () => {
    // Index 0 (current month) is a middling figure — neither peak nor
    // trough — so it only shows up because it IS the current month.
    const twelveMonths = twelveMonthData({
      0: { total: 50 },
      3: { total: 200 }, // peak
      7: { total: 10 }, // trough
    });
    const idx = labelledMonthIndices(twelveMonths);
    expect(idx.size).toBe(3);
    expect(idx.has(0)).toBe(true);
    expect(idx.has(3)).toBe(true);
    expect(idx.has(7)).toBe(true);
  });

  it("labels a month that is both peak and trough only once", () => {
    // The single payment lands in the current month, so peak, trough and
    // "current month" all resolve to index 0.
    const singlePaymentBook = twelveMonthData({ 0: { total: 40 } });
    const idx = labelledMonthIndices(singlePaymentBook);
    expect(idx.size).toBe(1);
    expect(idx.has(0)).toBe(true);
  });

  it("returns nothing to label when every month is empty", () => {
    const allEmpty = twelveMonthData();
    expect(labelledMonthIndices(allEmpty).size).toBe(0);
  });
});

describe("capSegment", () => {
  const base: MonthDatum = {
    month: "2026-08",
    paid: 0,
    confirmed: 0,
    estimated: 0,
    total: 0,
    mixedCurrency: false,
    dateEstimated: false,
  };

  it("caps on estimated when it is nonzero, regardless of the others", () => {
    expect(capSegment({ ...base, paid: 5, confirmed: 5, estimated: 5 })).toBe("estimated");
  });

  // The regression this guards against: a month that is paid + confirmed but
  // carries no estimated income at all (e.g. a near-term month whose whole
  // forward picture is already confirmed) has a $0 "estimated" bar, which
  // Recharts draws as no rectangle. Before this helper existed, the estimated
  // <Bar> unconditionally owned the "free end" 4px radius, so a month like
  // this one would silently keep a square top — the one case the mark spec's
  // "whichever segment is actually on top" rule exists for.
  it("caps on confirmed when estimated is zero but confirmed is not", () => {
    expect(capSegment({ ...base, paid: 5, confirmed: 5, estimated: 0 })).toBe("confirmed");
  });

  it("caps on paid when it is the only nonzero segment", () => {
    expect(capSegment({ ...base, paid: 5 })).toBe("paid");
  });

  it("returns null for an empty month", () => {
    expect(capSegment(base)).toBeNull();
  });
});

describe("monthTick", () => {
  it("prefixes a date-estimated month with a tilde", () => {
    expect(monthTick("2026-12", true)).toBe("~ Dec");
  });

  it("leaves a confirmed-date month unprefixed", () => {
    expect(monthTick("2026-09", false)).toBe("Sep");
  });

  it("still carries the year suffix on a January boundary alongside the tilde", () => {
    expect(monthTick("2027-01", true)).toBe("~ Jan '27");
  });
});

// The brief's own suggested version of this test rendered <ForwardPayments>
// and asserted on axis tick text ("~ Dec"). That does not work: this suite's
// jsdom ResponsiveContainer always measures 0×0 (see the note above
// `buildForwardChartData currency conflicts`), so Recharts renders an empty
// 0×0 div and NONE of the chart's children — axis ticks included — ever
// mount, regardless of whether the feature is implemented. The assertion
// fails identically before and after the change, which makes it a test of
// jsdom's layout engine, not of this file. Tested here at the two seams that
// ARE reachable under jsdom instead: the data-building pass that derives
// `dateEstimated` per month, and the pure `monthTick` formatter (above) that
// turns the flag into the "~" prefix. Between them they cover the same
// regression — a real render only needs to wire the two together, which the
// component body does in one line.
describe("buildForwardChartData date-estimated flag", () => {
  it("flags a month whose payment date is estimated, from a projected row", () => {
    const decProjected: ProjectedIncomeRowDTO[] = [
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        projectedExDate: "2026-12-10",
        paymentDate: "2026-12-15",
        paymentDateEstimated: true,
        confidence: "high",
        amountPerShare: "0.25",
        shares: "10",
        income: "2.50",
        currency: "USD",
      },
    ];
    const { byMonth } = buildForwardChartData([], [], decProjected, "2026-07");
    expect(byMonth.get("2026-12")!.dateEstimated).toBe(true);
    // An untouched month never flips the flag on.
    expect(byMonth.get("2026-09")!.dateEstimated).toBe(false);
  });

  it("leaves a confirmed announcement's month unflagged", () => {
    const { byMonth } = buildForwardChartData([], announced, [], "2026-07");
    expect(byMonth.get("2026-08")!.dateEstimated).toBe(false);
  });

  it("flags a month when only one of several contributing payments has an estimated date", () => {
    const augAnnounced: AnnouncedDividendDTO[] = [
      {
        symbol: "O",
        name: "Realty Income",
        declarationDate: null,
        exDate: "2026-08-01",
        recordDate: null,
        paymentDate: "2026-08-14",
        paymentDateEstimated: false,
        amountPerShare: "0.27",
        shares: "10",
        income: "2.70",
        currency: "USD",
      },
    ];
    const augProjected: ProjectedIncomeRowDTO[] = [
      {
        symbol: "MSFT",
        name: "Microsoft",
        projectedExDate: "2026-08-20",
        paymentDate: "2026-08-25",
        paymentDateEstimated: true,
        confidence: "low",
        amountPerShare: "0.75",
        shares: "20",
        income: "15.00",
        currency: "USD",
      },
    ];
    const { byMonth } = buildForwardChartData([], augAnnounced, augProjected, "2026-07");
    expect(byMonth.get("2026-08")!.dateEstimated).toBe(true);
  });
});

describe("ForwardPayments subtitle average", () => {
  it("names the average in the subtitle", () => {
    render(
      <ForwardPayments
        retroactive={[]}
        announced={announced}
        projected={projected}
        currentMonth="2026-07"
        currency="USD"
      />,
    );
    expect(screen.getByText(/\/ mo average/)).toBeInTheDocument();
  });

  // Not the brief's suggested empty-book fixture: with no forward payments at
  // all the card renders its "No forward payments yet" empty state, and the
  // subtitle omits the average trivially — the pre-change code never showed
  // an average in ANY scenario, so that assertion is satisfied by code that
  // hasn't implemented the feature at all and proves nothing (confirmed
  // empirically: it passes against the pre-change file). A window that mixes
  // currencies has real forward payments — the chart renders — but nothing
  // honest to average, which is the actual conditional (`avg != null`) this
  // guards.
  it("omits the average from the subtitle when the window mixes currencies", () => {
    const retroactive: RetroactiveIncomeRowDTO[] = [
      {
        symbol: "THAMES.L",
        name: "Thames Holdings",
        exDate: "2026-08-01",
        paymentDate: "2026-08-14",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        sharesHeld: "100",
        income: "100.00",
        currency: "DKK",
      },
    ];
    const announcedOtherMonth: AnnouncedDividendDTO[] = [
      {
        symbol: "O",
        name: "Realty Income",
        declarationDate: null,
        exDate: "2026-11-01",
        recordDate: null,
        paymentDate: "2026-11-14",
        paymentDateEstimated: false,
        amountPerShare: "1.00",
        shares: "10",
        income: "10.00",
        currency: "USD",
      },
    ];
    render(
      <ForwardPayments
        retroactive={retroactive}
        announced={announcedOtherMonth}
        projected={[]}
        currentMonth="2026-08"
        currency="USD"
      />,
    );
    expect(screen.getByText("Forward payments")).toBeInTheDocument();
    expect(screen.queryByText(/\/ mo average/)).not.toBeInTheDocument();
  });
});
