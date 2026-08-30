import { describe, it, expect } from "vitest";
import { isValidCurrency, assertValidCurrency, getMinorUnits } from "./currency";
import { InvalidCurrencyError } from "./errors";

describe("currency", () => {
  it("recognizes valid ISO 4217 codes", () => {
    expect(isValidCurrency("USD")).toBe(true);
    expect(isValidCurrency("EUR")).toBe(true);
    expect(isValidCurrency("JPY")).toBe(true);
    expect(isValidCurrency("XYZ")).toBe(false);
    expect(isValidCurrency("usd")).toBe(false);
  });

  it("assertValidCurrency throws InvalidCurrencyError for bad codes", () => {
    expect(() => assertValidCurrency("XYZ")).toThrow(InvalidCurrencyError);
    expect(() => assertValidCurrency("USD")).not.toThrow();
  });

  it("returns correct minor units per currency", () => {
    expect(getMinorUnits("USD")).toBe(2);
    expect(getMinorUnits("EUR")).toBe(2);
    expect(getMinorUnits("JPY")).toBe(0);
    expect(getMinorUnits("KWD")).toBe(3);
  });

  it("throws for minor units of an invalid currency", () => {
    expect(() => getMinorUnits("XYZ")).toThrow(InvalidCurrencyError);
  });
});
