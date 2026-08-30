import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PositionLine } from "./position-line";
import type { PositionDTO } from "../../lib/types";

function position(overrides: Partial<PositionDTO> = {}): PositionDTO {
  return {
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NASDAQ",
    currency: "USD",
    nativeCurrency: "USD",
    quantity: "10",
    averageCost: { amount: "150", currency: "USD" },
    costBasis: { amount: "1500", currency: "USD" },
    currentPrice: { amount: "190", currency: "USD" },
    marketValue: { amount: "1900", currency: "USD" },
    unrealizedGainLoss: { amount: "400", currency: "USD" },
    gainLossPercent: 26.6,
    dailyChange: { amount: "10", currency: "USD" },
    dailyChangePercent: 1.25,
    dividendIncome: null,
    totalReturn: { amount: "400", currency: "USD" },
    totalReturnPercent: 26.6,
    website: null,
    yieldOnCost: null,
    basisMismatch: null,
    ...overrides,
  };
}

describe("PositionLine", () => {
  it("shows the symbol, formatted market value, and gain-toned day change", () => {
    render(<PositionLine position={position({ dailyChangePercent: 1.25 })} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("$1,900.00")).toBeInTheDocument();
    const change = screen.getByText("+1.25% today");
    expect(change).toHaveClass("text-gain");
  });

  it("shows a loss-toned day change", () => {
    render(<PositionLine position={position({ dailyChangePercent: -2.5 })} />);
    expect(screen.getByText("-2.50% today")).toHaveClass("text-loss");
  });
});
