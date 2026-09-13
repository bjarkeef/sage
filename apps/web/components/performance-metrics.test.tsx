import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PerfMetrics } from "./performance-metrics";
import type { PerformanceDTO, PerformanceRelativeDTO } from "../lib/types";

function dto(overrides: Partial<PerformanceDTO> = {}): PerformanceDTO {
  return {
    displayCurrency: "USD",
    range: "1Y",
    window: { from: "2025-07-10", to: "2026-07-10", days: 365 },
    insufficientData: false,
    stalePrices: [],
    gain: { amount: "1432.00", currency: "USD" },
    simpleReturn: 0.05,
    twr: 0.1432,
    twrAnnualized: null,
    lifetime: {
      unrealised: { amount: "1200", currency: "DKK" },
      realised: { amount: "800", currency: "DKK" },
      income: { amount: "400", currency: "DKK" },
      total: { amount: "2400", currency: "DKK" },
    },
    volatility: 0.182,
    maxDrawdown: 0.093,
    bestDay: { date: "2026-04-09", value: 0.041 },
    worstDay: { date: "2026-03-02", value: -0.037 },
    indexSeries: [],
    benchmarks: [],
    multiCurrency: false,
    anomalousDays: 0,
    fxApproximated: false,
    relative: null,
    basisMismatches: [],
    unverifiedSplits: [],
    historyIncomplete: [],
    ...overrides,
  };
}

function relative(overrides: Partial<PerformanceRelativeDTO> = {}): PerformanceRelativeDTO {
  return {
    benchmarkId: "sp500",
    benchmarkName: "S&P 500",
    pairedDays: 250,
    minPairedDaysForBeta: 20,
    volatility: { value: 0.182, benchmark: 0.21, ratio: 0.8667 },
    maxDrawdown: { value: 0.093, benchmark: 0.116, ratio: 0.8017 },
    beta: 0.62,
    ...overrides,
  };
}

describe("PerfMetrics", () => {
  it("gives every figure its own titled card", () => {
    render(<PerfMetrics data={dto({ relative: relative() })} />);
    for (const title of [
      "Against the benchmarks",
      "Made since you started",
      "Volatility",
      "Beta",
      "Max drawdown",
      "Best and worst day",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("defines each metric in plain words, one tap away behind its info tooltip", () => {
    render(<PerfMetrics data={dto({ relative: relative() })} />);
    fireEvent.click(screen.getByRole("button", { name: /about: against the benchmarks/i }));
    expect(screen.getByText(/strips out when you added or sold/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /about: made since you started/i }));
    expect(screen.getByText(/over its whole life rather than the window/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /about: max drawdown/i }));
    expect(screen.getByText(/deepest fall from a peak/i)).toBeInTheDocument();
  });

  it("leads with the figure and moves the definition into a tooltip", () => {
    render(<PerfMetrics data={dto({ relative: relative() })} />);

    // Both halves matter. A test that only checks the tooltip exists would pass
    // with the paragraph still rendered above the figure -- and the paragraph is
    // the defect.
    expect(screen.queryByText(/How much the portfolio moved day to day/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /about: volatility/i }));
    expect(screen.getByText(/How much the portfolio moved day to day/i)).toBeInTheDocument();
  });

  it("explains beta as a movement ratio, which is the thing a number alone cannot say", () => {
    render(<PerfMetrics data={dto({ relative: relative() })} />);
    expect(
      screen.getByText("For every 1% the S&P 500 moved, your portfolio moved 0.62%."),
    ).toBeInTheDocument();
  });

  it("says beta moved the other way when it is negative", () => {
    render(<PerfMetrics data={dto({ relative: relative({ beta: -0.23 }) })} />);
    expect(
      screen.getByText("For every 1% the S&P 500 moved, your portfolio moved 0.23% the other way."),
    ).toBeInTheDocument();
  });

  it("puts volatility and drawdown in relation to the benchmark", () => {
    render(<PerfMetrics data={dto({ relative: relative() })} />);
    expect(screen.getByText("13% less day-to-day movement than the S&P 500.")).toBeInTheDocument();
    expect(
      screen.getByText("20% shallower than the S&P 500's own worst fall."),
    ).toBeInTheDocument();
  });

  it("explains a suppressed beta by the floor the API reported", () => {
    render(<PerfMetrics data={dto({ relative: relative({ beta: null, pairedDays: 6 }) })} />);
    expect(
      screen.getByText("Needs 20 overlapping market days to measure; this window has 6."),
    ).toBeInTheDocument();
  });

  it("says so plainly when there is no benchmark to compare against", () => {
    render(<PerfMetrics data={dto()} />);
    expect(screen.getAllByText("No benchmark data for this window.").length).toBeGreaterThan(0);
    // The figures themselves still render — the comparison is what is missing.
    expect(screen.getByText("18.2%")).toBeInTheDocument();
    expect(screen.getByText("−9.3%")).toBeInTheDocument();
  });

  it("compares the return against every benchmark on the chart", () => {
    render(
      <PerfMetrics
        data={dto({
          relative: relative(),
          benchmarks: [
            { id: "sp500", name: "S&P 500", twr: 0.115, points: [] },
            { id: "msci-world", name: "MSCI World", twr: 0.098, points: [] },
          ],
        })}
      />,
    );
    // Each benchmark's own return, and the gap in percentage points.
    // +14.32% vs +11.5% is +2.8pp; vs +9.8% is +4.5pp.
    expect(screen.getByText("+11.5%")).toBeInTheDocument();
    expect(screen.getByText("+9.8%")).toBeInTheDocument();
    // The primary gap is both the card's headline figure and its own row —
    // summary then detail, so two occurrences is correct here.
    expect(screen.getAllByText("+2.8pp")).toHaveLength(2);
    expect(screen.getByText("+4.5pp")).toBeInTheDocument();
    expect(screen.getByText("versus S&P 500")).toBeInTheDocument();
  });

  it("headlines the same benchmark the scales are pinned to, not whichever arrived first", () => {
    render(
      <PerfMetrics
        data={dto({
          relative: relative(), // pinned to sp500
          // Arrival order, which is not request order: MSCI resolved first.
          benchmarks: [
            { id: "msci-world", name: "MSCI World", twr: 0.098, points: [] },
            { id: "sp500", name: "S&P 500", twr: 0.115, points: [] },
          ],
        })}
      />,
    );
    expect(screen.getByText("versus S&P 500")).toBeInTheDocument();
    expect(screen.queryByText("versus MSCI World")).not.toBeInTheDocument();
  });

  it("shows both days in the best-and-worst card", () => {
    render(<PerfMetrics data={dto({ relative: relative() })} />);
    expect(screen.getByText("+4.1%")).toBeInTheDocument();
    expect(screen.getByText("-3.7%")).toBeInTheDocument();
  });

  it("renders an em dash rather than a fabricated figure when a value is missing", () => {
    render(<PerfMetrics data={dto({ lifetime: null, relative: relative() })} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
