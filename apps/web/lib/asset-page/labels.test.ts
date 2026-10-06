import { describe, it, expect } from "vitest";
import {
  basisWord,
  formatPct,
  formatPerShare,
  isFilled,
  isPositiveFigure,
  prettySector,
  signedPct,
} from "./labels";

describe("labels", () => {
  it("formats a per-share dividend as money, 2–4 decimals — never '1.5 EUR'", () => {
    expect(formatPerShare({ amount: "1.5", currency: "EUR" })).toBe("€1.50");
    expect(formatPerShare({ amount: "0.67492", currency: "EUR" })).toBe("€0.6749");
    expect(formatPerShare({ amount: "2", currency: "USD" })).toBe("$2.00");
  });

  it("formats fractions and signed percents with a true minus", () => {
    expect(formatPct(0.021666)).toBe("2.17%");
    expect(formatPct(0.7, 0)).toBe("70%");
    expect(signedPct(2.06)).toBe("+2.1%");
    expect(signedPct(-9.84)).toBe("−9.8%");
    expect(signedPct(0.04)).toBe("0.0%");
  });

  it("names the tax basis", () => {
    expect(basisWord(35)).toBe("after tax");
    expect(basisWord(0)).toBe("after tax");
    expect(basisWord(null)).toBe("before tax");
  });

  it("treats a provider's dash as empty", () => {
    expect(isFilled("–")).toBe(false);
    expect(isFilled(" - ")).toBe(false);
    expect(isFilled("")).toBe(false);
    expect(isFilled(null)).toBe(false);
    expect(isFilled("Large Blend")).toBe(true);
  });

  it("prettifies provider sector keys", () => {
    expect(prettySector("consumer_cyclical")).toBe("Consumer Cyclical");
  });
});

describe("isPositiveFigure", () => {
  it("accepts only a finite number above zero", () => {
    expect(isPositiveFigure("79000")).toBe(true);
    expect(isPositiveFigure("7790000000")).toBe(true);
    expect(isPositiveFigure("0")).toBe(false);
    expect(isPositiveFigure("0.00")).toBe(false);
    expect(isPositiveFigure("-5")).toBe(false);
    expect(isPositiveFigure("NaN")).toBe(false);
    expect(isPositiveFigure("n/a")).toBe(false);
    expect(isPositiveFigure(" ")).toBe(false);
    expect(isPositiveFigure(null)).toBe(false);
  });
});
