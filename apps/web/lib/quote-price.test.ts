import { describe, it, expect } from "vitest";
import { cleanQuotePrice } from "./quote-price";

describe("cleanQuotePrice", () => {
  // Real shapes from price_daily: a float32 price widened to a double.
  it("strips float32 widening noise", () => {
    expect(cleanQuotePrice("496.2699890136719")).toBe("496.27");
    expect(cleanQuotePrice("500.5899963378906")).toBe("500.59");
  });

  // An intraday quote can carry four decimals; those are real, not noise.
  it("keeps a genuine fourth decimal", () => {
    expect(cleanQuotePrice("338.2200927734375")).toBe("338.2201");
  });

  it("keeps the digits a sub-unit price needs", () => {
    expect(cleanQuotePrice(String(Math.fround(0.01234)))).toBe("0.01234");
    expect(cleanQuotePrice(String(Math.fround(1234.5)))).toBe("1234.5");
  });

  it("leaves an already-clean price alone", () => {
    expect(cleanQuotePrice("150.00")).toBe("150.00");
    expect(cleanQuotePrice("42")).toBe("42");
    expect(cleanQuotePrice("0.5")).toBe("0.5");
  });

  it("returns anything unparseable unchanged", () => {
    expect(cleanQuotePrice("n/a")).toBe("n/a");
  });
});
