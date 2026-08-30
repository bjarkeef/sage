import { describe, it, expect } from "vitest";
import { yieldByHolding, monthlyRhythm, yieldBySymbol } from "./dividend-derive";
import type { DividendPerHoldingDTO, PositionDTO, RetroactiveIncomeRowDTO } from "./types";

function position(overrides: Partial<PositionDTO> & { symbol: string }): PositionDTO {
  return {
    name: overrides.symbol,
    exchange: "NASDAQ",
    currency: "USD",
    nativeCurrency: "USD",
    quantity: "10",
    averageCost: { amount: "10", currency: "USD" },
    costBasis: { amount: "100", currency: "USD" },
    currentPrice: { amount: "10", currency: "USD" },
    marketValue: { amount: "100", currency: "USD" },
    unrealizedGainLoss: null,
    gainLossPercent: null,
    dailyChange: null,
    dailyChangePercent: null,
    dividendIncome: null,
    totalReturn: null,
    totalReturnPercent: null,
    website: null,
    yieldOnCost: null,
    basisMismatch: null,
    ...overrides,
  };
}

function perHolding(
  overrides: Partial<DividendPerHoldingDTO> & { symbol: string },
): DividendPerHoldingDTO {
  return {
    forwardAnnualIncome: { amount: "10", currency: "USD" },
    incomeShare: 0.5,
    cagr5y: null,
    trend: "unknown",
    ...overrides,
  };
}

describe("yieldByHolding", () => {
  it("joins forward income to market value and computes a percentage yield, sorted descending", () => {
    const rows = yieldByHolding(
      [
        perHolding({ symbol: "HIYLD", forwardAnnualIncome: { amount: "91", currency: "USD" } }),
        perHolding({ symbol: "FRANKA", forwardAnnualIncome: { amount: "71", currency: "USD" } }),
      ],
      [
        position({ symbol: "HIYLD", marketValue: { amount: "1000", currency: "USD" } }),
        position({ symbol: "FRANKA", marketValue: { amount: "1000", currency: "USD" } }),
      ],
    );
    expect(rows).toEqual([
      { symbol: "HIYLD", currentYield: 9.1 },
      { symbol: "FRANKA", currentYield: 7.1 },
    ]);
  });

  it("drops holdings with no market value, zero market value, or a currency mismatch", () => {
    const rows = yieldByHolding(
      [
        perHolding({ symbol: "NOPOS", forwardAnnualIncome: { amount: "10", currency: "USD" } }),
        perHolding({ symbol: "ZERO", forwardAnnualIncome: { amount: "10", currency: "USD" } }),
        perHolding({ symbol: "MISMATCH", forwardAnnualIncome: { amount: "10", currency: "EUR" } }),
        perHolding({ symbol: "OK", forwardAnnualIncome: { amount: "10", currency: "USD" } }),
      ],
      [
        position({ symbol: "ZERO", marketValue: { amount: "0", currency: "USD" } }),
        position({ symbol: "MISMATCH", marketValue: { amount: "100", currency: "USD" } }),
        position({ symbol: "OK", marketValue: { amount: "100", currency: "USD" } }),
      ],
    );
    expect(rows).toEqual([{ symbol: "OK", currentYield: 10 }]);
  });

  it("drops holdings with a null market value", () => {
    const rows = yieldByHolding(
      [perHolding({ symbol: "UNPRICED" })],
      [position({ symbol: "UNPRICED", marketValue: null })],
    );
    expect(rows).toEqual([]);
  });

  it("returns an empty array for empty inputs", () => {
    expect(yieldByHolding([], [])).toEqual([]);
  });
});

function retro(
  overrides: Partial<RetroactiveIncomeRowDTO> & { symbol: string },
): RetroactiveIncomeRowDTO {
  return {
    name: overrides.symbol,
    exDate: "2026-01-01",
    paymentDate: null,
    paymentDateEstimated: false,
    amountPerShare: "1",
    sharesHeld: "10",
    income: "10",
    currency: "USD",
    ...overrides,
  };
}

describe("monthlyRhythm", () => {
  it("buckets income by month of paymentDate, falling back to exDate", () => {
    const now = new Date(2026, 6, 14); // July 14, 2026 (local)
    const rows = monthlyRhythm(
      [
        retro({ symbol: "A", exDate: "2026-06-01", paymentDate: "2026-06-15", income: "30" }),
        retro({ symbol: "B", exDate: "2026-06-20", paymentDate: "2026-06-25", income: "20" }),
        retro({ symbol: "C", exDate: "2026-05-10", paymentDate: null, income: "15" }),
      ],
      now,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { month: "2026-06", amount: 50 },
        { month: "2026-05", amount: 15 },
      ]),
    );
  });

  it("excludes months outside the trailing 12-month window", () => {
    const now = new Date(2026, 6, 14); // July 14, 2026
    const rows = monthlyRhythm(
      [retro({ symbol: "OLD", exDate: "2024-01-01", paymentDate: "2024-01-01", income: "999" })],
      now,
    );
    expect(rows.find((r) => r.month === "2024-01")).toBeUndefined();
  });

  it("keeps the trailing-12 window correct across a year boundary", () => {
    const now = new Date(2026, 0, 14); // Jan 14, 2026 → window is Feb 2025 .. Jan 2026
    const rows = monthlyRhythm(
      [
        retro({ symbol: "IN", exDate: "2025-02-05", paymentDate: "2025-02-05", income: "40" }), // window start
        retro({ symbol: "NOW", exDate: "2026-01-03", paymentDate: "2026-01-03", income: "12" }), // window end
        retro({ symbol: "OUT", exDate: "2025-01-31", paymentDate: "2025-01-31", income: "999" }), // one month too old
      ],
      now,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { month: "2025-02", amount: 40 },
        { month: "2026-01", amount: 12 },
      ]),
    );
    expect(rows.find((r) => r.month === "2025-01")).toBeUndefined();
  });

  it("returns an empty array for empty input", () => {
    expect(monthlyRhythm([])).toEqual([]);
  });
});

describe("yieldBySymbol", () => {
  it("maps each holding's symbol to its forward yield %, omitting the uncomputable", () => {
    const rows = yieldBySymbol(
      [
        perHolding({ symbol: "O", forwardAnnualIncome: { amount: "29", currency: "USD" } }),
        perHolding({ symbol: "NOPRICE", forwardAnnualIncome: { amount: "5", currency: "USD" } }),
      ],
      [
        position({ symbol: "O", marketValue: { amount: "580", currency: "USD" } }),
        position({ symbol: "NOPRICE", marketValue: null }),
      ],
    );
    expect(rows.get("O")).toBeCloseTo(5, 5); // 29 / 580 * 100
    expect(rows.has("NOPRICE")).toBe(false);
  });
});
