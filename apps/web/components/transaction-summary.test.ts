import { describe, it, expect } from "vitest";
import { summarize, describeSavedTransaction } from "./transaction-summary";

describe("describeSavedTransaction", () => {
  it("names the side and the shares for a trade", () => {
    expect(describeSavedTransaction({ type: "buy", quantity: "10", symbol: "AAPL" })).toBe(
      "Bought 10 AAPL",
    );
    expect(describeSavedTransaction({ type: "sell", quantity: "4", symbol: "AAPL" })).toBe(
      "Sold 4 AAPL",
    );
  });

  it("omits the quantity where it is not a share count", () => {
    // On a dividend the quantity is the shares held, and on a split it is the
    // ratio — printing either as "10 AAPL" would read as shares transacted.
    expect(describeSavedTransaction({ type: "dividend", quantity: "10", symbol: "AAPL" })).toBe(
      "Dividend from AAPL",
    );
    expect(describeSavedTransaction({ type: "split", quantity: "2", symbol: "AAPL" })).toBe(
      "Split recorded for AAPL",
    );
  });
});

describe("summarize", () => {
  it("adds the fee to a buy", () => {
    // The bug this guards: a total that ignores the fee still looks like a
    // total. 10 × 305.93 = 3059.30, and a buy costs the fee on top.
    expect(
      summarize({ type: "buy", quantity: "10", price: "305.93", fee: "1.50" })?.amount,
    ).toBeCloseTo(3060.8, 10);
  });

  it("subtracts the fee from a sell", () => {
    expect(
      summarize({ type: "sell", quantity: "10", price: "305.93", fee: "1.50" })?.amount,
    ).toBeCloseTo(3057.8, 10);
  });

  it("ignores a blank fee", () => {
    expect(
      summarize({ type: "buy", quantity: "10", price: "305.93", fee: "" })?.amount,
    ).toBeCloseTo(3059.3, 10);
  });

  it("labels a dividend as received and never applies a fee", () => {
    // The fee input is hidden for dividends; a stale value must not leak in.
    const s = summarize({ type: "dividend", quantity: "10", price: "1.05", fee: "9.99" });
    expect(s?.label).toBe("Total received");
    expect(s?.amount).toBeCloseTo(10.5, 10);
  });

  it("labels a buy plainly", () => {
    expect(summarize({ type: "buy", quantity: "1", price: "1", fee: "" })?.label).toBe("Total");
  });

  it("has no amount until both quantity and price are present", () => {
    expect(summarize({ type: "buy", quantity: "", price: "305.93", fee: "" })?.amount).toBeNull();
    expect(summarize({ type: "buy", quantity: "10", price: "", fee: "" })?.amount).toBeNull();
  });

  it("has no amount for junk input rather than NaN", () => {
    expect(
      summarize({ type: "buy", quantity: "ten", price: "305.93", fee: "" })?.amount,
    ).toBeNull();
  });

  it("shows the arithmetic as a breakdown", () => {
    expect(summarize({ type: "buy", quantity: "10", price: "305.93", fee: "" })?.breakdown).toBe(
      "10 × 305.93",
    );
  });

  it("returns nothing at all for a split, which moves no money", () => {
    expect(summarize({ type: "split", quantity: "2", price: "0", fee: "" })).toBeNull();
  });
});
