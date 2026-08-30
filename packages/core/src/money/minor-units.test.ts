import { describe, it, expect } from "vitest";
import { Decimal } from "./decimal";
import { InvalidCurrencyError } from "./errors";
import { normalizeMinorUnit, moneyFromMinorUnit } from "./minor-units";

describe("normalizeMinorUnit", () => {
  it("maps Yahoo-style GBp (pence) to GBP with a divisor of 100", () => {
    const { currency, divisor } = normalizeMinorUnit("GBp");
    expect(currency).toBe("GBP");
    expect(divisor.toFixed()).toBe("100");
  });

  it("maps GBX (any case) to GBP with a divisor of 100", () => {
    expect(normalizeMinorUnit("GBX").currency).toBe("GBP");
    expect(normalizeMinorUnit("gbx").currency).toBe("GBP");
    expect(normalizeMinorUnit("gbx").divisor.toFixed()).toBe("100");
  });

  it("maps South African cents (ZAc) to ZAR / 100", () => {
    const { currency, divisor } = normalizeMinorUnit("ZAc");
    expect(currency).toBe("ZAR");
    expect(divisor.toFixed()).toBe("100");
  });

  it("leaves a major-unit code unchanged with divisor 1", () => {
    expect(normalizeMinorUnit("GBP")).toEqual({ currency: "GBP", divisor: new Decimal(1) });
    expect(normalizeMinorUnit("USD")).toEqual({ currency: "USD", divisor: new Decimal(1) });
  });

  it("upper-cases a lower-case major code (gbp = pounds, not pence)", () => {
    expect(normalizeMinorUnit("gbp")).toEqual({ currency: "GBP", divisor: new Decimal(1) });
  });
});

describe("moneyFromMinorUnit", () => {
  it("converts a pence amount into pounds", () => {
    const m = moneyFromMinorUnit("250", "GBp");
    expect(m.toJSON()).toEqual({ amount: "2.5", currency: "GBP" });
  });

  it("accepts a Decimal amount", () => {
    const m = moneyFromMinorUnit(new Decimal("99.5"), "GBX");
    expect(m.toJSON()).toEqual({ amount: "0.995", currency: "GBP" });
  });

  it("passes a major-unit amount through untouched", () => {
    const m = moneyFromMinorUnit("2.5", "GBP");
    expect(m.toJSON()).toEqual({ amount: "2.5", currency: "GBP" });
  });

  it("throws on an unknown currency, as Money.of does", () => {
    expect(() => moneyFromMinorUnit("1", "ZZZ")).toThrow(InvalidCurrencyError);
  });
});
