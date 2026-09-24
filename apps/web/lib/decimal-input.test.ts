import { describe, it, expect } from "vitest";
import { normalizeDecimalInput, parseDecimalInput } from "./decimal-input";

describe("parseDecimalInput", () => {
  it("parses either decimal mark", () => {
    expect(parseDecimalInput("27,5")).toBe(27.5);
    expect(parseDecimalInput("27.5")).toBe(27.5);
  });

  it("returns null for blank or unparseable input", () => {
    expect(parseDecimalInput("  ")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNull();
    expect(parseDecimalInput("1.000,50")).toBeNull();
  });
});

describe("normalizeDecimalInput", () => {
  it("reads a lone comma as the decimal mark", () => {
    expect(normalizeDecimalInput("1,12")).toBe("1.12");
    expect(normalizeDecimalInput("0,5")).toBe("0.5");
    expect(normalizeDecimalInput(",5")).toBe(".5");
  });

  it("leaves a dot decimal untouched", () => {
    expect(normalizeDecimalInput("1.12")).toBe("1.12");
    expect(normalizeDecimalInput("10")).toBe("10");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDecimalInput(" 1,12 ")).toBe("1.12");
  });

  it("keeps a sign so a negative still fails validation as negative", () => {
    expect(normalizeDecimalInput("-1,5")).toBe("-1.5");
  });

  // Mixed or repeated separators are grouping, and which one is grouping
  // depends on the locale. Guessing would silently store a figure 1000× off.
  it("does not guess at grouped numbers", () => {
    expect(normalizeDecimalInput("1.000,50")).toBe("1.000,50");
    expect(normalizeDecimalInput("1,000.50")).toBe("1,000.50");
    expect(normalizeDecimalInput("1,000,000")).toBe("1,000,000");
  });
});
