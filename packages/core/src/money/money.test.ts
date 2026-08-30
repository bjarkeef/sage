import { describe, it, expect } from "vitest";
import { Money } from "./money";
import { Decimal } from "./decimal";
import {
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidCurrencyError,
  MoneyError,
} from "./errors";

const usd = (a: string) => Money.of(a, "USD");

describe("Money construction", () => {
  it("constructs from string and Decimal", () => {
    expect(usd("10.50").toString()).toBe("10.5");
    expect(Money.of(new Decimal("3.14"), "USD").toString()).toBe("3.14");
  });

  it("rejects invalid currency and unparseable/non-finite amounts", () => {
    expect(() => Money.of("1", "XYZ")).toThrow(InvalidCurrencyError);
    expect(() => Money.of("abc", "USD")).toThrow(InvalidAmountError);
    expect(() => Money.of("Infinity", "USD")).toThrow(InvalidAmountError);
    expect(() => Money.of("NaN", "USD")).toThrow(InvalidAmountError);
    // a number sneaking past the types at runtime is rejected
    expect(() => Money.of(1 as unknown as string, "USD")).toThrow(InvalidAmountError);
  });

  it("zero() yields a zero amount in the currency", () => {
    expect(Money.zero("USD").isZero()).toBe(true);
  });
});

describe("Money arithmetic", () => {
  it("adds, subtracts, multiplies and divides at full precision", () => {
    expect(usd("10.50").plus(usd("0.25")).toString()).toBe("10.75");
    expect(usd("10.50").minus(usd("0.25")).toString()).toBe("10.25");
    expect(Money.of("0.12345", "USD").times("17").toString()).toBe("2.09865");
    expect(usd("10").dividedBy("4").toString()).toBe("2.5");
    expect(usd("10.50").negated().toString()).toBe("-10.5");
    expect(usd("-10.50").abs().toString()).toBe("10.5");
  });

  it("throws on cross-currency add/subtract", () => {
    expect(() => usd("1").plus(Money.of("1", "EUR"))).toThrow(CurrencyMismatchError);
    expect(() => usd("1").minus(Money.of("1", "EUR"))).toThrow(CurrencyMismatchError);
  });

  it("rejects a native number factor", () => {
    expect(() => usd("1").times(2 as unknown as string)).toThrow(InvalidAmountError);
  });

  it("rejects division by zero instead of producing a non-finite amount", () => {
    expect(() => usd("10").dividedBy("0")).toThrow(InvalidAmountError);
    expect(() => usd("0").dividedBy("0")).toThrow(InvalidAmountError);
  });
});

describe("Money comparison", () => {
  it("compares within a currency", () => {
    expect(usd("1").lessThan(usd("2"))).toBe(true);
    expect(usd("2").greaterThan(usd("1"))).toBe(true);
    expect(usd("1").lessThanOrEqual(usd("1"))).toBe(true);
    expect(usd("1").compareTo(usd("1"))).toBe(0);
  });

  it("equals is value-based and currency-aware (no throw)", () => {
    expect(Money.of("1.10", "USD").equals(usd("1.1"))).toBe(true);
    expect(usd("1").equals(Money.of("1", "EUR"))).toBe(false);
  });

  it("ordering across currencies throws", () => {
    expect(() => usd("1").compareTo(Money.of("1", "EUR"))).toThrow(CurrencyMismatchError);
  });

  it("sign predicates", () => {
    expect(usd("1").isPositive()).toBe(true);
    expect(usd("-1").isNegative()).toBe(true);
    expect(usd("0").isPositive()).toBe(false);
    expect(usd("0").isNegative()).toBe(false);
  });
});

describe("Money rounding", () => {
  it("rounds to currency minor units (half-even default)", () => {
    expect(usd("1.005").round().toString()).toBe("1");
    expect(usd("1.015").round().toString()).toBe("1.02");
    expect(Money.of("100.5", "JPY").round().toString()).toBe("100");
    expect(Money.of("1.2345", "KWD").round().toString()).toBe("1.234");
  });

  it("accepts an explicit rounding mode", () => {
    expect(usd("1.005").round("half-up").toString()).toBe("1.01");
  });
});

describe("Money allocation and split", () => {
  it("splits without losing minor units", () => {
    const parts = usd("0.05")
      .split(3)
      .map((m) => m.toString());
    expect(parts).toEqual(["0.02", "0.02", "0.01"]);
  });

  it("allocates by weights and sums exactly to the original", () => {
    const parts = usd("100").allocate([70, 30]);
    expect(parts.map((m) => m.toString())).toEqual(["70", "30"]);
    expect(Money.sum(parts).equals(usd("100"))).toBe(true);
  });

  it("handles zero-decimal currencies", () => {
    const parts = Money.of("100", "JPY")
      .split(3)
      .map((m) => m.toString());
    expect(parts).toEqual(["34", "33", "33"]);
  });

  it("preserves sign for negative amounts", () => {
    const parts = usd("-0.05")
      .split(3)
      .map((m) => m.toString());
    expect(parts).toEqual(["-0.02", "-0.02", "-0.01"]);
  });

  it("breaks ties toward lower-index weights (deterministic)", () => {
    const parts = usd("0.02")
      .allocate([1, 1, 1, 1])
      .map((m) => m.toString());
    expect(parts).toEqual(["0.01", "0.01", "0", "0"]);
  });

  it("gives a zero-weight party exactly zero (no rounding artifact)", () => {
    const parts = usd("100")
      .allocate([1, 0])
      .map((m) => m.toString());
    expect(parts).toEqual(["100", "0"]);
  });

  it("rejects empty/negative weights and non-positive split counts", () => {
    expect(() => usd("1").allocate([])).toThrow(InvalidAmountError);
    expect(() => usd("1").allocate([1, -1])).toThrow(InvalidAmountError);
    expect(() => usd("1").split(0)).toThrow(InvalidAmountError);
  });
});

describe("Money sum / serialization / formatting", () => {
  it("sums same-currency lists and requires a currency when empty", () => {
    expect(Money.sum([usd("1"), usd("2"), usd("3")]).toString()).toBe("6");
    expect(Money.sum([], "USD").isZero()).toBe(true);
    expect(() => Money.sum([])).toThrow(MoneyError);
    expect(() => Money.sum([usd("1"), Money.of("1", "EUR")])).toThrow(CurrencyMismatchError);
  });

  it("round-trips through JSON / toString", () => {
    const m = usd("12.34");
    expect(m.toJSON()).toEqual({ amount: "12.34", currency: "USD" });
    expect(Money.fromJSON(m.toJSON()).equals(m)).toBe(true);
    expect(Money.of("0.0000001", "USD").toString()).toBe("0.0000001");
  });

  it("formats per locale and currency", () => {
    expect(Money.of("1234.5", "USD").format("en-US")).toBe("$1,234.50");
    expect(Money.of("100", "JPY").format("ja-JP")).toBe("￥100");
  });
});
