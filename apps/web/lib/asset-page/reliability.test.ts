import { describe, it, expect } from "vitest";
import {
  checkCurrentYield,
  checkTrailingSum,
  daysBetween,
  payoutRatioFlag,
  peFlag,
  perShareJumpFlag,
  staleAsOf,
  yieldRangeFlag,
} from "./reliability";
import { TODAY, assetDetail, day, quarterlyHistory, usd } from "../test/asset-fixtures";

describe("staleAsOf", () => {
  it("dates a provider figure inline once it is more than 7 days old", () => {
    expect(staleAsOf(day(-7), TODAY)).toBeNull();
    expect(staleAsOf(day(-8), TODAY)).toMatch(/^as of [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(staleAsOf(`${day(-30)}T08:00:00.000Z`, TODAY)).not.toBeNull();
    expect(staleAsOf(null, TODAY)).toBeNull();
    expect(daysBetween(day(-8), TODAY)).toBe(8);
  });
});

describe("plausibility flags", () => {
  it("flags a payout ratio outside 0–300%", () => {
    expect(payoutRatioFlag(0.7)).toBeNull();
    expect(payoutRatioFlag(3)).toBeNull();
    expect(payoutRatioFlag(0)).toBeNull();
    expect(payoutRatioFlag(3.01)?.reason).toContain("0–300%");
    expect(payoutRatioFlag(-0.2)).not.toBeNull();
    expect(payoutRatioFlag(null)).toBeNull();
  });

  it("flags a P/E at or below zero", () => {
    expect(peFlag(24.5)).toBeNull();
    expect(peFlag(0)).not.toBeNull();
    expect(peFlag(-4)).not.toBeNull();
    expect(peFlag(null)).toBeNull();
  });

  it("flags a 5-yr yield range whose high is more than 5× its low", () => {
    expect(yieldRangeFlag({ low: 0.02, high: 0.1 })).toBeNull();
    expect(yieldRangeFlag({ low: 0.02, high: 0.1001 })).not.toBeNull();
    expect(yieldRangeFlag({ low: 0, high: 0.03 })).not.toBeNull();
    expect(yieldRangeFlag(null)).toBeNull();
  });

  it("flags a year paying more than 3× the year before", () => {
    expect(perShareJumpFlag(3.5, 1.2)).toBeNull();
    expect(perShareJumpFlag(3.61, 1.2)).not.toBeNull();
    expect(perShareJumpFlag(3.6, 1.2)).toBeNull(); // exactly 3�, despite 3 * 1.2 = 3.5999999999999996
    expect(perShareJumpFlag(5, 0)).toBeNull();
    expect(perShareJumpFlag(5, null)).toBeNull();
  });
});

describe("consistency checks", () => {
  it("the trailing 12 months of payments sum to annualDividend", () => {
    expect(checkTrailingSum(quarterlyHistory(), usd("2"), TODAY)).toEqual({
      ok: true,
      trailing: 2,
      annual: 2,
    });
    expect(checkTrailingSum(quarterlyHistory(), usd("2.5"), TODAY).ok).toBe(false);
    // Nothing to compare against is not a disagreement.
    expect(checkTrailingSum(quarterlyHistory(), null, TODAY).ok).toBe(true);
  });

  it("current yield equals TTM ÷ the header price", () => {
    const d = assetDetail();
    expect(checkCurrentYield(d.income.currentYield, d.income.annualDividend, d.quote)).toBe(true);
    expect(checkCurrentYield(0.05, d.income.annualDividend, d.quote)).toBe(false);
    expect(checkCurrentYield(0.033333, { amount: "2", currency: "EUR" }, d.quote)).toBe(false);
    expect(checkCurrentYield(null, d.income.annualDividend, d.quote)).toBe(true);
  });
});
