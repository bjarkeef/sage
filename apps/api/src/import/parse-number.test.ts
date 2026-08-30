import { describe, it, expect } from "vitest";
import { parseNumber } from "./parse-number";

describe("parseNumber", () => {
  it("reads a plain decimal", () => {
    expect(parseNumber("241.30")).toBe("241.3");
    expect(parseNumber("10")).toBe("10");
    expect(parseNumber("0")).toBe("0");
  });

  it("strips currency symbols and codes", () => {
    expect(parseNumber("$241.30")).toBe("241.3");
    expect(parseNumber("€1.50")).toBe("1.5");
    expect(parseNumber("£12")).toBe("12");
    expect(parseNumber("241.30 USD")).toBe("241.3");
    expect(parseNumber("kr 99,50")).toBe("99.5");
  });

  it("reads US grouping", () => {
    expect(parseNumber("1,200")).toBe("1200");
    expect(parseNumber("1,241.30")).toBe("1241.3");
    expect(parseNumber("1,234,567.89")).toBe("1234567.89");
    expect(parseNumber("$1,234.56")).toBe("1234.56");
  });

  it("reads European grouping and decimal comma", () => {
    expect(parseNumber("241,30")).toBe("241.3");
    expect(parseNumber("1.234,56")).toBe("1234.56");
    expect(parseNumber("1.234.567,89")).toBe("1234567.89");
  });

  it("reads space and apostrophe grouping", () => {
    expect(parseNumber("1 234,56")).toBe("1234.56");
    expect(parseNumber("1'234.56")).toBe("1234.56");
    expect(parseNumber("1 234,56")).toBe("1234.56");
  });

  it("treats a lone comma with three trailing digits as grouping", () => {
    // 1,200 shares is twelve hundred, not one and one fifth.
    expect(parseNumber("1,200")).toBe("1200");
  });

  it("treats a lone comma with a leading zero as a decimal point", () => {
    // Nobody writes 0,123 to mean one hundred twenty-three.
    expect(parseNumber("0,123")).toBe("0.123");
    expect(parseNumber("0,5")).toBe("0.5");
  });

  it("leaves a lone dot as a decimal point", () => {
    // 1.234 is a price far more often than it is European for 1234, and the
    // review table shows the user what we read either way.
    expect(parseNumber("1.234")).toBe("1.234");
  });

  it("reads signs, including accounting parentheses", () => {
    expect(parseNumber("-1.00")).toBe("-1");
    expect(parseNumber("+45")).toBe("45");
    expect(parseNumber("(1,234.56)")).toBe("-1234.56");
    expect(parseNumber("-$5.00")).toBe("-5");
  });

  it("returns null for text carrying no number", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("   ")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
    expect(parseNumber("-")).toBeNull();
    expect(parseNumber("$")).toBeNull();
  });

  it("returns null for incoherent separator runs", () => {
    expect(parseNumber("1.0.0")).toBeNull();
    expect(parseNumber("1,2,3")).toBeNull();
  });
});
