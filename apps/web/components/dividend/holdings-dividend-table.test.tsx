import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { HoldingsDividendTable } from "./holdings-dividend-table";
import type { DividendPerHoldingDTO, PositionDTO } from "../../lib/types";

function h(overrides: Partial<DividendPerHoldingDTO> & { symbol: string }): DividendPerHoldingDTO {
  return {
    forwardAnnualIncome: { amount: "10", currency: "USD" },
    incomeShare: 0.1,
    cagr5y: null,
    trend: "unknown",
    ...overrides,
  };
}

function p(overrides: Partial<PositionDTO> & { symbol: string }): PositionDTO {
  return {
    name: overrides.symbol,
    exchange: "NASDAQ",
    currency: "USD",
    nativeCurrency: "USD",
    quantity: "10",
    averageCost: { amount: "10", currency: "USD" },
    costBasis: { amount: "100", currency: "USD" },
    currentPrice: { amount: "10", currency: "USD" },
    marketValue: { amount: "1000", currency: "USD" },
    unrealizedGainLoss: null,
    gainLossPercent: null,
    dailyChange: null,
    dailyChangePercent: null,
    dividendIncome: null,
    totalReturn: null,
    totalReturnPercent: null,
    website: null,
    yieldOnCost: 0.02,
    basisMismatch: null,
    ...overrides,
  };
}

// Annual desc: ZML(200) > AAPL(100) > MSFT(50) — a different order than
// symbol-alphabetical (AAPL, MSFT, ZML), so the two sorts are distinguishable.
const perHolding: DividendPerHoldingDTO[] = [
  h({ symbol: "ZML", forwardAnnualIncome: { amount: "200", currency: "USD" }, incomeShare: 0.5 }),
  h({
    symbol: "AAPL",
    forwardAnnualIncome: { amount: "100", currency: "USD" },
    incomeShare: 0.25,
    cagr5y: "0.12",
    trend: "climbing",
  }),
  h({
    symbol: "MSFT",
    forwardAnnualIncome: { amount: "50", currency: "USD" },
    incomeShare: 0.125,
    cagr5y: "-0.05",
    trend: "cutting",
  }),
];

const positions: PositionDTO[] = [
  p({ symbol: "ZML", marketValue: { amount: "1000", currency: "USD" }, yieldOnCost: null }),
  p({ symbol: "AAPL", marketValue: { amount: "2000", currency: "USD" }, yieldOnCost: 0.03 }),
  p({ symbol: "MSFT", marketValue: { amount: "1500", currency: "USD" }, yieldOnCost: 0.02 }),
];

describe("HoldingsDividendTable", () => {
  it("defaults to Annual (forward income) desc", () => {
    render(<HoldingsDividendTable perHolding={perHolding} positions={positions} />);
    const rows = screen.getAllByTestId("holding-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("ZML"),
      expect.stringContaining("AAPL"),
      expect.stringContaining("MSFT"),
    ]);
  });

  it("sorts by symbol when the Holding header is clicked", () => {
    render(<HoldingsDividendTable perHolding={perHolding} positions={positions} />);
    fireEvent.click(screen.getByText("Holding"));
    const rows = screen.getAllByTestId("holding-row");
    expect(rows[0]).toHaveTextContent("AAPL");
    expect(rows[1]).toHaveTextContent("MSFT");
    expect(rows[2]).toHaveTextContent("ZML");
  });

  it("renders — for null yield-on-cost and null CAGR", () => {
    render(<HoldingsDividendTable perHolding={perHolding} positions={positions} />);
    const zmlRow = screen
      .getAllByTestId("holding-row")
      .find((r) => r.textContent?.includes("ZML"))!;
    expect(within(zmlRow).getByTestId("yield-on-cost")).toHaveTextContent("—");
    expect(within(zmlRow).getByTestId("growth")).toHaveTextContent("—");

    const aaplRow = screen
      .getAllByTestId("holding-row")
      .find((r) => r.textContent?.includes("AAPL"))!;
    expect(within(aaplRow).getByTestId("yield-on-cost")).toHaveTextContent("3.0%");
    expect(within(aaplRow).getByTestId("growth")).toHaveTextContent("12%");
  });

  it("toggles direction on re-click and always sorts nulls last (ascending)", () => {
    render(<HoldingsDividendTable perHolding={perHolding} positions={positions} />);
    // ZML has null yield-on-cost; MSFT=2.0%, AAPL=3.0%.
    const yocHeader = screen.getByText("Yield on cost");
    fireEvent.click(yocHeader); // first click → desc: AAPL(3), MSFT(2), ZML(null last)
    let rows = screen.getAllByTestId("holding-row");
    expect(rows[0]).toHaveTextContent("AAPL");
    expect(rows[2]).toHaveTextContent("ZML"); // null last even in desc
    fireEvent.click(yocHeader); // re-click → asc: MSFT(2), AAPL(3), ZML(null STILL last)
    rows = screen.getAllByTestId("holding-row");
    expect(rows[0]).toHaveTextContent("MSFT");
    expect(rows[1]).toHaveTextContent("AAPL");
    expect(rows[2]).toHaveTextContent("ZML"); // null last regardless of direction
  });

  it("links each row to /asset/SYMBOL", () => {
    render(<HoldingsDividendTable perHolding={perHolding} positions={positions} />);
    const zmlRow = screen
      .getAllByTestId("holding-row")
      .find((r) => r.textContent?.includes("ZML"))!;
    expect(zmlRow).toHaveAttribute("href", "/asset/ZML");
  });

  it("renders nothing when no holding joins to a position", () => {
    const { container } = render(
      <HoldingsDividendTable perHolding={[h({ symbol: "ORPHAN" })]} positions={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("scales 'Yield on cost' by `factor` — pos.yieldOnCost is gross and is never netted upstream", () => {
    render(<HoldingsDividendTable perHolding={perHolding} positions={positions} factor={0.65} />);
    // AAPL yieldOnCost = 0.03 (3%, gross) × 0.65 = 1.95%.
    const aaplRow = screen
      .getAllByTestId("holding-row")
      .find((r) => r.textContent?.includes("AAPL"))!;
    expect(within(aaplRow).getByTestId("yield-on-cost")).toHaveTextContent("2.0%");
  });

  it("defaults `factor` to 1 (unchanged) when the caller doesn't pass a tax rate", () => {
    render(<HoldingsDividendTable perHolding={perHolding} positions={positions} />);
    const aaplRow = screen
      .getAllByTestId("holding-row")
      .find((r) => r.textContent?.includes("AAPL"))!;
    expect(within(aaplRow).getByTestId("yield-on-cost")).toHaveTextContent("3.0%");
  });
});
