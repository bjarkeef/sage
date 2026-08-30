import { describe, it, expect } from "vitest";
import {
  normalizeDecimal,
  computeRowHash,
  assignOccurrences,
  pairIncomingWithAutoRows,
} from "./dedupe";
import type { ImportTransaction } from "./types";

function tx(overrides: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    symbol: "AAPL",
    type: "buy",
    quantity: "10",
    price: "100",
    currency: "USD",
    tradeDate: "2026-01-01",
    fee: null,
    feeCurrency: null,
    exchange: "NASDAQ",
    rowNumber: 2,
    ...overrides,
  };
}

describe("normalizeDecimal", () => {
  it("canonicalizes formatting variants to one representation", () => {
    expect(normalizeDecimal("10")).toBe(normalizeDecimal("10.0"));
    expect(normalizeDecimal("10")).toBe(normalizeDecimal("10.00"));
    expect(normalizeDecimal("10")).toBe(normalizeDecimal("1e1"));
  });

  it("never emits exponent notation", () => {
    expect(normalizeDecimal("1e-7")).toBe("0.0000001");
    expect(normalizeDecimal("1.5e3")).toBe("1500");
  });
});

describe("computeRowHash", () => {
  it("is identical across quantity/price formatting variants", () => {
    expect(computeRowHash(tx({ quantity: "10", price: "100" }))).toBe(
      computeRowHash(tx({ quantity: "10.00", price: "1e2" })),
    );
  });

  it("ignores fee differences", () => {
    expect(computeRowHash(tx({ fee: "5", feeCurrency: "USD" }))).toBe(
      computeRowHash(tx({ fee: null, feeCurrency: null })),
    );
  });

  it("changes when any identity field changes", () => {
    const base = computeRowHash(tx());
    expect(computeRowHash(tx({ symbol: "MSFT" }))).not.toBe(base);
    expect(computeRowHash(tx({ type: "sell" }))).not.toBe(base);
    expect(computeRowHash(tx({ tradeDate: "2026-01-02" }))).not.toBe(base);
    expect(computeRowHash(tx({ quantity: "11" }))).not.toBe(base);
    expect(computeRowHash(tx({ price: "101" }))).not.toBe(base);
    expect(computeRowHash(tx({ currency: "EUR" }))).not.toBe(base);
  });

  it("is a 64-char lowercase sha256 hex string", () => {
    expect(computeRowHash(tx())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the golden vector — the wire format is persisted, never change it", () => {
    // sha256("AAPL|buy|2026-01-01|10|100|USD"). Ledger rows store these hashes;
    // any change to field order, delimiter, or normalization orphans them all.
    expect(computeRowHash(tx())).toBe(
      "acd1c98846748f4b16906eac4a8e7a6b141bbf5170367e13eac756143d3f7c49",
    );
  });
});

describe("assignOccurrences", () => {
  it("gives identical rows sequential occurrence indices in file order", () => {
    const rows = assignOccurrences([tx(), tx(), tx({ symbol: "MSFT" }), tx()]);
    expect(rows.map((r) => r.occurrence)).toEqual([0, 1, 0, 2]);
    expect(rows[0]!.rowHash).toBe(rows[1]!.rowHash);
    expect(rows[2]!.rowHash).not.toBe(rows[0]!.rowHash);
  });

  it("treats formatting variants as the same row for occurrence counting", () => {
    const rows = assignOccurrences([tx({ quantity: "10" }), tx({ quantity: "10.0" })]);
    expect(rows.map((r) => r.occurrence)).toEqual([0, 1]);
  });
});

describe("pairIncomingWithAutoRows", () => {
  const auto = (id: string, tradeDate: string) => ({ transactionId: id, tradeDate });

  it("pairs an incoming dividend with the nearest auto row within 10 days", () => {
    const pairs = pairIncomingWithAutoRows(
      [{ index: 0, tradeDate: "2025-05-17" }],
      [auto("a1", "2025-05-15")],
    );
    expect(pairs).toEqual(new Map([[0, "a1"]]));
  });

  it("does not pair beyond the 10-day window", () => {
    const pairs = pairIncomingWithAutoRows(
      [{ index: 0, tradeDate: "2025-05-28" }],
      [auto("a1", "2025-05-15")],
    );
    expect(pairs.size).toBe(0);
  });

  it("pairs one-to-one, nearest first (monthly payer safety)", () => {
    const pairs = pairIncomingWithAutoRows(
      [
        { index: 0, tradeDate: "2025-05-16" },
        { index: 1, tradeDate: "2025-05-14" },
      ],
      [auto("a1", "2025-05-15"), auto("a2", "2025-06-15")],
    );
    // Both incoming rows sit near a1; only the nearer (index 1, 1 day) gets it.
    // index 0 (1 day too, tie broken by order) — deterministic either way:
    expect(pairs.size).toBe(1);
    expect([...pairs.values()]).toEqual(["a1"]);
  });
});
