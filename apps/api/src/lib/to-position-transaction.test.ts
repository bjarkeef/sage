import { describe, it, expect } from "vitest";
import { Decimal } from "@sage/core";
import { feeInTradeCurrency, toPositionTransaction } from "./to-position-transaction";

/** ECB-shaped lookup: units of `currency` per euro. */
const rates: Record<string, string> = { DKK: "7.4748", USD: "1.0921", EUR: "1" };
const rateOn = (_date: string, currency: string): Decimal | null =>
  rates[currency] ? new Decimal(rates[currency]) : null;

describe("feeInTradeCurrency", () => {
  const row = (fee: string | null, feeCurrency: string | null) => ({
    fee,
    feeCurrency,
    currency: "USD",
    tradeDate: "2023-12-22",
  });

  it("passes a fee already in the trade's currency straight through", () => {
    expect(feeInTradeCurrency(row("1.25", "USD"))!.amount.toString()).toBe("1.25");
  });

  // Four of the reporting book's purchases were charged this way: bought in
  // USD, billed in DKK at around 90 kroner a time. Dropping them understates
  // what those shares cost.
  it("converts a fee billed in another currency at the trade date", () => {
    const fee = feeInTradeCurrency(row("88.08", "DKK"), rateOn);

    // 88.08 DKK / 7.4748 = 11.7836 EUR, x 1.0921 = 12.8686 USD.
    expect(fee!.currency).toBe("USD");
    expect(Number(fee!.amount)).toBeCloseTo(12.8686, 3);
  });

  it("treats a missing fee currency as the trade's own", () => {
    expect(feeInTradeCurrency(row("2", null))!.amount.toString()).toBe("2");
  });

  it("returns null rather than a wrong number when no rate is available", () => {
    expect(feeInTradeCurrency(row("88.08", "DKK"))).toBeNull();
    expect(feeInTradeCurrency(row("88.08", "ZWL"), rateOn)).toBeNull();
  });

  it("returns null for absent and zero fees", () => {
    expect(feeInTradeCurrency(row(null, null))).toBeNull();
    expect(feeInTradeCurrency(row("0", "USD"))).toBeNull();
  });
});

describe("toPositionTransaction", () => {
  const base = {
    id: "row-1",
    instrumentSymbol: "AAPL",
    type: "buy",
    quantity: "10",
    price: "100",
    currency: "USD",
    tradeDate: "2024-01-02",
    createdAt: new Date("2024-01-02T10:00:00Z"),
  };

  it("carries the fee onto the transaction", () => {
    expect(
      toPositionTransaction({ ...base, fee: "25", feeCurrency: "USD" }).fee!.amount.toString(),
    ).toBe("25");
  });

  it("leaves `fee` absent when the row has none", () => {
    expect(toPositionTransaction(base).fee).toBeUndefined();
  });

  // `Array.prototype.map` passes the index as the second argument, which is
  // how this quietly became `rateOn = 0` the first time it was wired up.
  it("is not safe to pass straight to map, and typing says so", () => {
    const tx = toPositionTransaction({ ...base, fee: "88.08", feeCurrency: "DKK" }, rateOn);
    expect(Number(tx.fee!.amount)).toBeCloseTo(12.8686, 3);
  });
});
