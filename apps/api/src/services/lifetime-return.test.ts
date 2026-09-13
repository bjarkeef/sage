import { describe, it, expect } from "vitest";
import { Decimal } from "@sage/core";
import { computeLifetimeReturn } from "./lifetime-return";
import type { TransactionRow } from "./portfolio-book";
import type { SeriesFxLookup } from "./valuation-series";

/** `divisor`: units of the source currency per 1 DKK, by date — divide by it.
 *  So 0.140 means one krone bought 14 US cents. */
const RATES: Record<string, Record<string, string>> = {
  USD: { "2023-01-01": "0.140", "2024-01-01": "0.145", "2025-01-01": "0.155" },
  DKK: { "2023-01-01": "1", "2024-01-01": "1", "2025-01-01": "1" },
};

/** `divisor` is units of the SOURCE currency per target unit — divide by it. */
const fx: SeriesFxLookup = {
  rateOn(date, currency) {
    const table = RATES[currency];
    if (!table) return null;
    const keys = Object.keys(table)
      .filter((k) => k <= date)
      .sort();
    const key = keys[keys.length - 1];
    const value = key === undefined ? undefined : table[key];
    if (value === undefined) return null;
    return { divisor: new Decimal(value), approximated: false };
  },
};

let seq = 0;
function row(
  p: Partial<TransactionRow> & Pick<TransactionRow, "type" | "tradeDate">,
): TransactionRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    portfolioId: "pf",
    instrumentSymbol: "AAPL",
    quantity: "10",
    price: "100",
    currency: "USD",
    fee: null,
    feeCurrency: null,
    source: null,
    createdAt: new Date(`${p.tradeDate}T00:00:00Z`),
    ...p,
  };
}

describe("computeLifetimeReturn", () => {
  it("reports nothing for a book that has never sold or been paid", () => {
    const r = computeLifetimeReturn([row({ type: "buy", tradeDate: "2024-01-05" })], fx, "DKK");
    expect(r.realised.toString()).toBe("0");
    expect(r.income.toString()).toBe("0");
  });

  // Cost at the purchase date, proceeds at the sale's. Converting both at the
  // sale's rate would erase the currency move, which for a Danish holder of
  // American shares is part of what was actually made.
  it("prices a sale's cost and proceeds on their own dates", () => {
    const r = computeLifetimeReturn(
      [
        row({ type: "buy", tradeDate: "2023-06-01", quantity: "10", price: "100" }),
        row({ type: "sell", tradeDate: "2025-06-01", quantity: "10", price: "120" }),
      ],
      fx,
      "DKK",
    );

    // 1000 USD in at 0.140 = 7142.857...; 1200 USD out at 0.155 = 7741.935...
    expect(Number(r.realised)).toBeCloseTo(7741.935 - 7142.857, 2);
  });

  it("counts the buy's fee in cost and the sell's against proceeds", () => {
    const r = computeLifetimeReturn(
      [
        row({ type: "buy", tradeDate: "2024-02-01", price: "100", fee: "20", feeCurrency: "USD" }),
        row({ type: "sell", tradeDate: "2024-08-01", price: "100", fee: "30", feeCurrency: "USD" }),
      ],
      fx,
      "DKK",
    );

    // Same price both ways at one rate: the whole loss is the two fees.
    expect(Number(r.realised)).toBeCloseTo(-50 / 0.145, 2);
  });

  // Three of the reporting book's symbols were bought in DKK and sold in USD.
  it("handles a lot bought in one currency and sold in another", () => {
    const r = computeLifetimeReturn(
      [
        row({ type: "buy", tradeDate: "2023-06-01", quantity: "2", price: "700", currency: "DKK" }),
        row({
          type: "sell",
          tradeDate: "2025-06-01",
          quantity: "2",
          price: "110",
          currency: "USD",
        }),
      ],
      fx,
      "DKK",
    );

    // 1400 DKK in; 220 USD out at 0.155 = 1419.35.
    expect(Number(r.realised)).toBeCloseTo(1419.35 - 1400, 1);
  });

  it("banks dividends net of the tax withheld", () => {
    const r = computeLifetimeReturn(
      [
        row({
          type: "dividend",
          tradeDate: "2024-03-01",
          quantity: "10",
          price: "2",
          fee: "7",
          feeCurrency: "USD",
        }),
      ],
      fx,
      "DKK",
    );

    // 20 gross less 7 withheld = 13 USD at 0.145.
    expect(Number(r.income)).toBeCloseTo(13 / 0.145, 2);
  });

  it("counts income from holdings that have since been sold", () => {
    const r = computeLifetimeReturn(
      [
        row({ type: "buy", tradeDate: "2024-01-05" }),
        row({ type: "dividend", tradeDate: "2024-03-01", quantity: "10", price: "1" }),
        row({ type: "sell", tradeDate: "2024-06-01" }),
      ],
      fx,
      "DKK",
    );

    expect(Number(r.income)).toBeCloseTo(10 / 0.145, 2);
  });

  // Short rather than wrong: ECB publishes no INR, so a flow in one is left
  // out and the caller is told the total is missing something.
  it("flags a flow it cannot price instead of dropping it silently", () => {
    const r = computeLifetimeReturn(
      [
        row({ type: "buy", tradeDate: "2024-01-05", currency: "INR" }),
        row({ type: "sell", tradeDate: "2024-06-01", currency: "INR" }),
      ],
      fx,
      "DKK",
    );

    expect(r.incomplete).toBe(true);
    expect(r.realised.toString()).toBe("0");
  });
});
