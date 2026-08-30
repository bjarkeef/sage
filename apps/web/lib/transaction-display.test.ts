import { describe, it, expect } from "vitest";
import { totalLabel, typeChipTone } from "./transaction-display";
import type { TransactionRow } from "./types";

function row(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: "1",
    instrumentSymbol: "AAPL",
    name: "Apple Inc.",
    type: "buy",
    quantity: "10",
    price: "150",
    currency: "USD",
    fee: null,
    feeCurrency: null,
    tradeDate: "2026-06-14",
    source: null,
    ...overrides,
  };
}

describe("totalLabel", () => {
  it("multiplies quantity by price in the row's own currency", () => {
    expect(totalLabel(row())).toBe("$1,500.00");
    expect(totalLabel(row({ currency: "EUR", quantity: "2", price: "10" }))).toBe("€20.00");
  });

  it("falls back to the raw components rather than printing NaN", () => {
    // Neither caller exercises this branch, but a non-numeric quantity reaching
    // the UI should degrade to something readable, not "$NaN".
    expect(totalLabel(row({ quantity: "unknown" }))).toBe("unknown × 150 USD");
  });
});

describe("typeChipTone", () => {
  it("gives every transaction type a tone", () => {
    // A missing entry renders an undefined tone, which silently falls back to
    // the neutral chip and hides the type distinction.
    for (const type of ["buy", "sell", "dividend", "split"] as const) {
      expect(typeChipTone[type]).toBeTruthy();
    }
  });

  it("marks only dividends as income", () => {
    expect(typeChipTone.dividend).toBe("income");
    expect(typeChipTone.buy).not.toBe("income");
  });
});
