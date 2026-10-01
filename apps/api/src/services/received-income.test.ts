import { describe, it, expect } from "vitest";
import { Decimal, type ReceivedDividendRow } from "@sage/core";
import { receivedTotal } from "./received-income";

function row(symbol: string, income: string, currency = "USD"): ReceivedDividendRow {
  return {
    symbol,
    cashDate: "2026-03-15", // a ledger fact, never compared with the clock here
    income,
    currency,
    amountPerShare: null,
    sharesHeld: null,
  };
}

describe("receivedTotal", () => {
  it("sums one symbol's received rows in its own currency", () => {
    const t = receivedTotal([row("KO", "4.60"), row("KO", "4.85"), row("O", "1.25")], "KO", "USD");
    expect(t!.amount.toFixed(2)).toBe("9.45");
    expect(t!.leftOut).toBe(0);
  });

  it("is null when nothing has been received — not zero", () => {
    expect(receivedTotal([row("O", "1.25")], "KO", "USD")).toBeNull();
  });

  it("converts a row in another currency, and leaves out and counts one it cannot convert", () => {
    const rows = [row("KO", "10.00"), row("KO", "8.00", "EUR"), row("KO", "50.00", "SEK")];
    const t = receivedTotal(rows, "KO", "USD", (amount, from) =>
      from === "EUR" ? amount.times(new Decimal("1.25")) : null,
    );
    expect(t!.amount.toFixed(2)).toBe("20.00"); // 10 + 8 × 1.25; the SEK row is never summed raw
    expect(t!.leftOut).toBe(1);
  });

  it("without a converter, leaves out every row in another currency", () => {
    const t = receivedTotal([row("KO", "10.00"), row("KO", "8.00", "EUR")], "KO", "USD");
    expect(t!.amount.toFixed(2)).toBe("10.00");
    expect(t!.leftOut).toBe(1);
  });
});
