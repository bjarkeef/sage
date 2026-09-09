import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PerformanceCard } from "./performance-card";
import { PortfolioCard } from "./portfolio-card";
import { UpcomingCard } from "./upcoming-card";
import type { PositionDTO, UpcomingRow } from "../../lib/types";

const upcomingRow = (o: Partial<UpcomingRow> & { symbol: string }): UpcomingRow => ({
  name: `${o.symbol} Inc`,
  date: "2026-08-14",
  income: "5.42",
  currency: "USD",
  dateEstimated: false,
  projected: false,
  ...o,
});

/** Relative to `new Date()` so these fixtures never rot into past dates. */
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const pos = (o: Partial<PositionDTO>): PositionDTO => ({
  symbol: "AAPL",
  name: "Apple",
  exchange: "XNAS",
  currency: "USD",
  nativeCurrency: "USD",
  quantity: "10",
  averageCost: { amount: "100", currency: "USD" },
  costBasis: { amount: "1000", currency: "USD" },
  currentPrice: { amount: "150", currency: "USD" },
  marketValue: { amount: "1500", currency: "USD" },
  unrealizedGainLoss: { amount: "500", currency: "USD" },
  gainLossPercent: 50,
  dailyChange: null,
  dailyChangePercent: null,
  dividendIncome: null,
  totalReturn: null,
  totalReturnPercent: null,
  website: null,
  yieldOnCost: null,
  basisMismatch: null,
  ...o,
});

describe("PerformanceCard", () => {
  it("shows YTD and total return", () => {
    render(
      <PerformanceCard
        ytdPercent={16.15}
        totalReturn={{ amount: { amount: "2192", currency: "USD" }, percent: 41.7 }}
        relative={null}
        benchmarkYtdTwr={null}
      />,
    );
    expect(screen.getByText(/16\.15%/)).toBeInTheDocument();
    expect(screen.getByText(/2,192/)).toBeInTheDocument();
  });

  // `PerformanceRelativeDTO` carries risk ratios, not a return — the gap
  // figure comes from the separately-published `benchmarkYtdTwr`, so both
  // must be present for the card to say anything about a benchmark.
  it("shows the benchmark gap instead of empty space", () => {
    render(
      <PerformanceCard
        ytdPercent={16.02}
        totalReturn={null}
        relative={{
          benchmarkId: "sp500",
          benchmarkName: "S&P 500",
          pairedDays: 120,
          minPairedDaysForBeta: 60,
          volatility: null,
          maxDrawdown: null,
          beta: null,
        }}
        benchmarkYtdTwr={0.125}
      />,
    );
    expect(screen.getByText(/S&P 500/)).toBeInTheDocument();
    // 16.02% vs 12.5% is a +3.5pp gap.
    expect(screen.getByText(/\+3\.5pp/)).toBeInTheDocument();
  });

  it("keeps its shape when no benchmark is available", () => {
    // Null is the honest answer on a book whose history outruns every index.
    render(
      <PerformanceCard
        ytdPercent={16.02}
        totalReturn={null}
        relative={null}
        benchmarkYtdTwr={null}
      />,
    );
    expect(screen.getByText("+16.02%")).toBeInTheDocument();
    expect(screen.queryByText(/S&P 500/)).not.toBeInTheDocument();
  });

  // `relative` alone isn't enough — a benchmark that reached the beta/vol
  // window but not the YTD one (or a cache-only miss) would otherwise print
  // a name with no figure next to it.
  it("keeps its shape when relative exists but benchmarkYtdTwr is null", () => {
    render(
      <PerformanceCard
        ytdPercent={16.02}
        totalReturn={null}
        relative={{
          benchmarkId: "sp500",
          benchmarkName: "S&P 500",
          pairedDays: 120,
          minPairedDaysForBeta: 60,
          volatility: null,
          maxDrawdown: null,
          beta: null,
        }}
        benchmarkYtdTwr={null}
      />,
    );
    expect(screen.queryByText(/S&P 500/)).not.toBeInTheDocument();
  });
});

describe("PortfolioCard", () => {
  it("shows the top 5 holdings by market value, largest first", () => {
    const positions = [
      pos({ symbol: "SML", marketValue: { amount: "100", currency: "USD" } }),
      pos({ symbol: "BIG", marketValue: { amount: "9000", currency: "USD" } }),
    ];
    render(<PortfolioCard positions={positions} />);
    const syms = screen.getAllByTestId("holding-symbol").map((n) => n.textContent);
    expect(syms[0]).toBe("BIG");
  });
});

describe("UpcomingCard", () => {
  it("renders upcoming dividends with human dates", () => {
    render(
      <UpcomingCard
        upcoming={[upcomingRow({ symbol: "O", date: "2026-08-14", income: "5.42" })]}
        todayISO="2026-07-17"
        taxRate={null}
      />,
    );
    expect(screen.getByText("O")).toBeInTheDocument();
    expect(screen.getByText(/Aug 14/)).toBeInTheDocument();
  });

  it("labels amounts 'Before tax' and renders them gross when no rate is set", () => {
    render(
      <UpcomingCard
        upcoming={[upcomingRow({ symbol: "O", date: "2026-08-14", income: "100.00" })]}
        todayISO="2026-07-17"
        taxRate={null}
      />,
    );
    expect(screen.getByText(/100\.00/)).toBeInTheDocument();
    expect(screen.getByText("Before tax")).toBeInTheDocument();
  });

  it("labels amounts 'After tax' and nets the raw (gross) amount when a rate is configured", () => {
    render(
      <UpcomingCard
        upcoming={[upcomingRow({ symbol: "O", date: "2026-08-14", income: "100.00" })]}
        todayISO="2026-07-17"
        taxRate={35}
      />,
    );
    expect(screen.getByText(/65\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/100\.00/)).not.toBeInTheDocument();
    expect(screen.getByText("After tax")).toBeInTheDocument();
  });

  it("shows no tax label when there are no upcoming dividends", () => {
    render(<UpcomingCard upcoming={[]} todayISO="2026-07-17" taxRate={35} />);
    expect(screen.queryByText("After tax")).not.toBeInTheDocument();
    expect(screen.queryByText("Before tax")).not.toBeInTheDocument();
    // The empty state itself is untouched by Task 11 (it lives entirely
    // outside the branch this task rewrote), so this half of the assertion
    // can't fail against the pre-Task-11 component — it's folded in here
    // rather than kept as its own always-green test.
    expect(screen.getByText("No dividends scheduled.")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  // Two independent facts: `~` says Sage predicted the DATE, `≈` says Sage
  // forecast the AMOUNT. An announced dividend can carry a predicted pay
  // date, so the date mark must track `dateEstimated` alone — not `projected`.
  it("marks a predicted date but not a declared one", () => {
    render(
      <UpcomingCard
        upcoming={[
          upcomingRow({ symbol: "O", date: daysFromNow(3), dateEstimated: false }),
          upcomingRow({ symbol: "THAMES.L", date: daysFromNow(10), dateEstimated: true }),
        ]}
        todayISO={daysFromNow(0)}
        taxRate={null}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).queryByTestId("date-estimated-mark")).not.toBeInTheDocument();
    expect(within(rows[1]!).getByTestId("date-estimated-mark")).toBeInTheDocument();
    // The legend explains a mark that is actually visible on this render.
    expect(screen.getByText("~ estimated date")).toBeInTheDocument();
  });

  it("marks a forecast amount but not a declared one", () => {
    render(
      <UpcomingCard
        upcoming={[
          upcomingRow({ symbol: "O", date: daysFromNow(3), projected: false }),
          upcomingRow({
            symbol: "NORDA-B",
            date: daysFromNow(12),
            projected: true,
            dateEstimated: false,
          }),
        ]}
        todayISO={daysFromNow(0)}
        taxRate={null}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).queryByTestId("amount-projected-mark")).not.toBeInTheDocument();
    expect(within(rows[1]!).getByTestId("amount-projected-mark")).toBeInTheDocument();
  });

  // The original defect: a book with only forecast income (nothing a company
  // has announced yet) rendered the empty state instead of the forecast rows.
  it("renders rows on a book with nothing announced", () => {
    render(
      <UpcomingCard
        upcoming={[
          upcomingRow({ symbol: "O", date: daysFromNow(5), projected: true, dateEstimated: true }),
          upcomingRow({
            symbol: "NORDA-B",
            date: daysFromNow(9),
            projected: true,
            dateEstimated: true,
          }),
        ]}
        todayISO={daysFromNow(0)}
        taxRate={null}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("No dividends scheduled.")).not.toBeInTheDocument();
  });

  // The legend must read the rows actually rendered after the card's own
  // cap, not the full input array — a book that hands the card more rows
  // than it displays must not surface a mark for a row nobody can see.
  it("omits the estimated-date legend when no visible row is estimated", () => {
    const rows = [
      upcomingRow({ symbol: "A1", date: daysFromNow(1) }),
      upcomingRow({ symbol: "A2", date: daysFromNow(2) }),
      upcomingRow({ symbol: "A3", date: daysFromNow(3) }),
      upcomingRow({ symbol: "A4", date: daysFromNow(4) }),
      upcomingRow({ symbol: "A5", date: daysFromNow(5) }),
      upcomingRow({ symbol: "A6", date: daysFromNow(6), dateEstimated: true }),
    ];
    render(<UpcomingCard upcoming={rows} todayISO={daysFromNow(0)} taxRate={null} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText("~ estimated date")).not.toBeInTheDocument();
  });

  it("marks a YTD figure computed over incomplete price history", () => {
    render(
      <PerformanceCard
        ytdPercent={9.1}
        totalReturn={null}
        incomplete
        relative={null}
        benchmarkYtdTwr={null}
      />,
    );
    expect(screen.getByLabelText(/incomplete/i)).toBeInTheDocument();
  });

  it("shows no marker on a complete figure", () => {
    render(
      <PerformanceCard
        ytdPercent={9.1}
        totalReturn={null}
        relative={null}
        benchmarkYtdTwr={null}
      />,
    );
    expect(screen.queryByLabelText(/incomplete/i)).not.toBeInTheDocument();
  });
});
