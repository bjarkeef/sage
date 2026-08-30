import { describe, it, expect } from "vitest";
import { validateTransactionForm, validateTransactionFields } from "./validate-transaction";
import type { SearchResultDTO } from "./types";

const apple: SearchResultDTO = {
  symbol: "AAPL",
  name: "Apple Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};

describe("validateTransactionForm", () => {
  it("accepts a valid buy", () => {
    const r = validateTransactionForm({
      instrument: apple,
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "2026-01-01",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a missing instrument", () => {
    const r = validateTransactionForm({
      instrument: null,
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "2026-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.instrument).toBeDefined();
  });

  it("rejects non-positive quantity and price", () => {
    const r = validateTransactionForm({
      instrument: apple,
      type: "buy",
      quantity: "0",
      price: "-5",
      tradeDate: "2026-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.quantity).toBeDefined();
      expect(r.errors.price).toBeDefined();
    }
  });

  it("rejects a malformed date", () => {
    const r = validateTransactionForm({
      instrument: apple,
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "01/01/2026",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.tradeDate).toBeDefined();
  });
});

describe("validateTransactionFields", () => {
  it("accepts valid fields", () => {
    const r = validateTransactionFields({
      type: "sell",
      quantity: "3",
      price: "12.5",
      tradeDate: "2026-02-01",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.quantity).toBe("3");
  });

  it("rejects non-positive quantity and price", () => {
    const r = validateTransactionFields({
      type: "buy",
      quantity: "0",
      price: "-1",
      tradeDate: "2026-02-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.quantity).toBeDefined();
      expect(r.errors.price).toBeDefined();
    }
  });

  it("rejects a malformed date", () => {
    const r = validateTransactionFields({
      type: "buy",
      quantity: "1",
      price: "1",
      tradeDate: "2026/02/01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.tradeDate).toBeDefined();
  });
});

describe("fee validation", () => {
  const buy = (fee: string) => ({
    type: "buy" as const,
    quantity: "10",
    price: "100",
    fee,
    tradeDate: "2026-01-01",
  });

  it("accepts an empty fee", () => {
    expect(validateTransactionFields(buy("")).ok).toBe(true);
  });
  it("accepts a zero fee", () => {
    expect(validateTransactionFields(buy("0")).ok).toBe(true);
  });
  it("accepts a positive decimal fee", () => {
    expect(validateTransactionFields(buy("1.25")).ok).toBe(true);
  });
  it("rejects a negative fee", () => {
    const r = validateTransactionFields(buy("-1"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.fee).toBeDefined();
  });
  it("rejects a non-numeric fee", () => {
    const r = validateTransactionFields(buy("abc"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.fee).toBeDefined();
  });
});
