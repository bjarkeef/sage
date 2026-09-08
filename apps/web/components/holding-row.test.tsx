import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithClient } from "../lib/test/render-with-client";

// HoldingRow renders TransactionDialog, which imports ../lib/api; without
// this mock getInstrumentQuote is undefined and the dialog's quote effect
// throws calling .then on it.
vi.mock("../lib/api", () => ({
  createTransaction: vi.fn().mockResolvedValue({ id: "new" }),
  updateTransaction: vi.fn().mockResolvedValue(undefined),
  getInstrumentQuote: vi.fn().mockResolvedValue(null),
}));

import { HoldingRow } from "./holding-row";
import type { PositionDTO } from "../lib/types";

function position(overrides: Partial<PositionDTO> = {}): PositionDTO {
  return {
    symbol: "AAPL",
    name: "Apple Inc",
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
    dailyChange: { amount: "20", currency: "USD" },
    dailyChangePercent: 1.35,
    dividendIncome: { amount: "20", currency: "USD" },
    totalReturn: { amount: "520", currency: "USD" },
    totalReturnPercent: 52,
    website: "https://apple.com",
    yieldOnCost: 0.032,
    basisMismatch: null,
    ...overrides,
  };
}

describe("HoldingRow", () => {
  it("renders no secondary line when the holding has no real name", () => {
    renderWithClient(
      <HoldingRow position={position({ symbol: "ACME", name: "ACME" })} groupTotal={1500} />,
    );
    // The symbol appears exactly once — as the primary, not echoed beneath it.
    expect(screen.getAllByText("ACME")).toHaveLength(1);
  });

  it("renders the name when there is a real one", () => {
    renderWithClient(
      <HoldingRow
        position={position({ symbol: "THAMES.L", name: "Thames Water plc" })}
        groupTotal={1500}
      />,
    );
    expect(screen.getByText("Thames Water plc")).toBeInTheDocument();
  });
});
