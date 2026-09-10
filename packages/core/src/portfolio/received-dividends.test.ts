import { describe, it, expect } from "vitest";
import { buildReceivedDividends, type LedgerDividendRow } from "./received-dividends";

function row(over: Partial<LedgerDividendRow> = {}): LedgerDividendRow {
  return {
    symbol: "AAPL",
    type: "dividend",
    quantity: "2",
    price: "0.24",
    currency: "USD",
    tradeDate: "2023-08-11",
    source: null,
    ...over,
  };
}

describe("buildReceivedDividends", () => {
  it("keeps only dividend rows", () => {
    const out = buildReceivedDividends(
      [row(), row({ type: "buy" }), row({ type: "sell" }), row({ type: "split" })],
      "2026-07-21",
    );
    expect(out).toHaveLength(1);
  });

  it("computes income as quantity x price", () => {
    const out = buildReceivedDividends([row({ quantity: "2", price: "0.24" })], "2026-07-21");
    expect(out[0]!.income).toBe("0.48");
  });

  it("uses tradeDate as the cash date", () => {
    const out = buildReceivedDividends([row({ tradeDate: "2023-11-17" })], "2026-07-21");
    expect(out[0]!.cashDate).toBe("2023-11-17");
  });

  it("excludes rows dated after today", () => {
    const out = buildReceivedDividends(
      [row({ tradeDate: "2026-07-20" }), row({ tradeDate: "2026-07-22" })],
      "2026-07-21",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.cashDate).toBe("2026-07-20");
  });

  it("includes a row dated exactly today", () => {
    const out = buildReceivedDividends([row({ tradeDate: "2026-07-21" })], "2026-07-21");
    expect(out).toHaveLength(1);
  });

  it("carries per-share and shares for auto-sourced rows", () => {
    // planAutoDividends writes quantity = shares held, price = amountPerShare,
    // so the convention is guaranteed for these and only these.
    const out = buildReceivedDividends(
      [row({ source: "auto", quantity: "20", price: "0.271" })],
      "2026-07-21",
    );
    expect(out[0]!.sharesHeld).toBe("20");
    expect(out[0]!.amountPerShare).toBe("0.271");
    expect(out[0]!.income).toBe("5.42");
  });

  it("leaves per-share null for imported rows, never back-computing it", () => {
    // Imported rows do not follow the convention: this observed row is 1 x the
    // DKK TOTAL for a period when 2 shares were held, so 3.30 is not per-share.
    const out = buildReceivedDividends(
      [row({ source: null, quantity: "1", price: "3.3", currency: "DKK" })],
      "2026-07-21",
    );
    expect(out[0]!.amountPerShare).toBeNull();
    expect(out[0]!.sharesHeld).toBeNull();
    expect(out[0]!.income).toBe("3.30");
  });

  it("treats quantity x price as GROSS even when the row also carries a fee", () => {
    // INVARIANT-SETTLING CASE (see commit investigation): live-data query
    // confirmed quantity x price already equals the provider's GROSS
    // per-share amount x shares, with a separately-recorded fee sitting
    // alongside it rather than already netted into the price — the shape a
    // foreign-listed dividend with withholding tax takes when a broker
    // records the withheld amount as its own fee row. `LedgerDividendRow`
    // doesn't even carry a `fee` field into this function — by design,
    // nothing here ever nets it. If a future change starts subtracting or
    // adding fee here, this assertion is what breaks. Figures are invented,
    // chosen only to keep the arithmetic exact.
    const out = buildReceivedDividends(
      [row({ quantity: "12.5", price: "0.6784", currency: "EUR" })],
      "2026-07-21",
    );
    expect(out[0]!.income).toBe("8.48");
  });

  it("preserves the row currency", () => {
    const out = buildReceivedDividends([row({ currency: "DKK" })], "2026-07-21");
    expect(out[0]!.currency).toBe("DKK");
  });

  it("sorts by cash date ascending, then symbol", () => {
    const out = buildReceivedDividends(
      [
        row({ symbol: "MSFT", tradeDate: "2024-01-02" }),
        row({ symbol: "AAPL", tradeDate: "2023-05-01" }),
        row({ symbol: "AAPL", tradeDate: "2024-01-02" }),
      ],
      "2026-07-21",
    );
    expect(out.map((r) => `${r.cashDate}|${r.symbol}`)).toEqual([
      "2023-05-01|AAPL",
      "2024-01-02|AAPL",
      "2024-01-02|MSFT",
    ]);
  });

  it("returns an empty array for an empty ledger", () => {
    expect(buildReceivedDividends([], "2026-07-21")).toEqual([]);
  });
});
