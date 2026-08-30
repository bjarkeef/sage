import { describe, it, expect } from "vitest";
import { computePortfolioYields, computeGrossForwardYield } from "./portfolio-yields";
import type { DividendPerHoldingDTO, PositionDTO } from "./types";

function pos(overrides: Partial<PositionDTO>): PositionDTO {
  return {
    symbol: "X",
    name: "X",
    exchange: "XNAS",
    currency: "DKK",
    nativeCurrency: "DKK",
    quantity: "1",
    averageCost: { amount: "100", currency: "DKK" },
    costBasis: { amount: "100", currency: "DKK" },
    currentPrice: { amount: "100", currency: "DKK" },
    marketValue: { amount: "100", currency: "DKK" },
    unrealizedGainLoss: { amount: "0", currency: "DKK" },
    gainLossPercent: 0,
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

describe("computePortfolioYields", () => {
  it("dilutes the dividend yield with non-dividend holdings in the denominator", () => {
    // Payer: 1000 cost / 1000 value, 5% yield-on-cost -> 50 annual dividend.
    // Non-payer: 1000 value, no dividend.
    const positions = [
      pos({
        costBasis: { amount: "1000", currency: "DKK" },
        marketValue: { amount: "1000", currency: "DKK" },
        yieldOnCost: 0.05,
      }),
      pos({
        costBasis: { amount: "1000", currency: "DKK" },
        marketValue: { amount: "1000", currency: "DKK" },
        yieldOnCost: null,
      }),
    ];
    const { dividendYield } = computePortfolioYields(positions);
    // 50 / 2000 = 2.5%, not 5% — the non-payer counts in the denominator.
    expect(dividendYield).toBeCloseTo(2.5, 6);
  });

  it("computes yield on cost over the whole portfolio cost basis", () => {
    const positions = [
      pos({ costBasis: { amount: "1000", currency: "DKK" }, yieldOnCost: 0.04 }),
      pos({ costBasis: { amount: "3000", currency: "DKK" }, yieldOnCost: null }),
    ];
    // 40 annual dividend / 4000 total cost = 1%.
    expect(computePortfolioYields(positions).yieldOnCost).toBeCloseTo(1, 6);
  });

  it("excludes unpriced positions from market value but keeps their cost basis", () => {
    const positions = [
      pos({
        costBasis: { amount: "1000", currency: "DKK" },
        marketValue: null,
        yieldOnCost: 0.05,
      }),
    ];
    const { yieldOnCost, dividendYield } = computePortfolioYields(positions);
    expect(yieldOnCost).toBeCloseTo(5, 6); // 50 / 1000
    expect(dividendYield).toBeNull(); // no market value to divide by
  });

  it("returns nulls for an empty portfolio", () => {
    expect(computePortfolioYields([])).toEqual({ yieldOnCost: null, dividendYield: null });
  });

  it("returns null when cost bases span more than one currency (no silent FX mix)", () => {
    const positions = [
      pos({
        costBasis: { amount: "1000", currency: "USD" },
        marketValue: { amount: "1000", currency: "USD" },
        yieldOnCost: 0.05,
      }),
      pos({
        costBasis: { amount: "1000", currency: "DKK" },
        marketValue: { amount: "1000", currency: "DKK" },
        yieldOnCost: 0.05,
      }),
    ];
    expect(computePortfolioYields(positions)).toEqual({
      yieldOnCost: null,
      dividendYield: null,
    });
  });

  it("nulls only dividendYield when market values mix currencies but cost is unified", () => {
    // Incomplete display-FX: cost converted to DKK, one market value still USD.
    const positions = [
      pos({
        costBasis: { amount: "1000", currency: "DKK" },
        marketValue: { amount: "1000", currency: "DKK" },
        yieldOnCost: 0.05,
      }),
      pos({
        costBasis: { amount: "1000", currency: "DKK" },
        marketValue: { amount: "1000", currency: "USD" },
        yieldOnCost: null,
      }),
    ];
    const { yieldOnCost, dividendYield } = computePortfolioYields(positions);
    expect(yieldOnCost).toBeCloseTo(2.5, 6); // 50 / 2000
    expect(dividendYield).toBeNull();
  });
});

function holding(overrides: Partial<DividendPerHoldingDTO>): DividendPerHoldingDTO {
  return {
    symbol: "X",
    forwardAnnualIncome: { amount: "0", currency: "DKK" },
    incomeShare: 0,
    cagr5y: null,
    trend: "unknown",
    ...overrides,
  };
}

describe("computeGrossForwardYield", () => {
  it("sums forward income over market value across holdings sharing one currency", () => {
    const perHolding = [
      holding({ symbol: "A", forwardAnnualIncome: { amount: "50", currency: "DKK" } }),
      holding({ symbol: "B", forwardAnnualIncome: { amount: "30", currency: "DKK" } }),
    ];
    const positions = [
      pos({ symbol: "A", marketValue: { amount: "1000", currency: "DKK" } }),
      pos({ symbol: "B", marketValue: { amount: "1000", currency: "DKK" } }),
    ];
    // (50 + 30) / (1000 + 1000) = 4%
    expect(computeGrossForwardYield(perHolding, positions)).toBeCloseTo(4, 6);
  });

  it("excludes holdings with marketValue <= 0 from both numerator and denominator", () => {
    const perHolding = [
      holding({ symbol: "A", forwardAnnualIncome: { amount: "50", currency: "DKK" } }),
      holding({ symbol: "B", forwardAnnualIncome: { amount: "999", currency: "DKK" } }),
    ];
    const positions = [
      pos({ symbol: "A", marketValue: { amount: "1000", currency: "DKK" } }),
      pos({ symbol: "B", marketValue: null }),
    ];
    // B's marketValue is null -> excluded entirely: 50 / 1000 = 5%
    expect(computeGrossForwardYield(perHolding, positions)).toBeCloseTo(5, 6);
  });

  it("returns null when contributing holdings span more than one currency", () => {
    const perHolding = [
      holding({ symbol: "A", forwardAnnualIncome: { amount: "50", currency: "USD" } }),
      holding({ symbol: "B", forwardAnnualIncome: { amount: "30", currency: "DKK" } }),
    ];
    const positions = [
      pos({ symbol: "A", marketValue: { amount: "1000", currency: "USD" } }),
      pos({ symbol: "B", marketValue: { amount: "1000", currency: "DKK" } }),
    ];
    expect(computeGrossForwardYield(perHolding, positions)).toBeNull();
  });

  it("returns null when there is no market-valued, dividend-paying overlap", () => {
    expect(computeGrossForwardYield([], [])).toBeNull();
  });

  it("skips a row whose forward-income currency disagrees with its market-value currency", () => {
    const perHolding = [
      // Mislabeled/inconsistent row — must not be trusted even alone.
      holding({ symbol: "A", forwardAnnualIncome: { amount: "50", currency: "USD" } }),
    ];
    const positions = [pos({ symbol: "A", marketValue: { amount: "1000", currency: "DKK" } })];
    expect(computeGrossForwardYield(perHolding, positions)).toBeNull();
  });
});
