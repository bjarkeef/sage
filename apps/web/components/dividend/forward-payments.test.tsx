import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ForwardPayments,
  ForwardTooltip,
  buildForwardChartData,
  forwardBarLabel,
} from "./forward-payments";
import type {
  AnnouncedDividendDTO,
  ProjectedIncomeRowDTO,
  RetroactiveIncomeRowDTO,
} from "../../lib/types";

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
