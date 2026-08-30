import { describe, it, expect } from "vitest";
import { ExchangeRate } from "./exchange-rate";
import { Money } from "./money";
import { CurrencyMismatchError, InvalidAmountError, InvalidCurrencyError } from "./errors";

describe("ExchangeRate", () => {
  it("converts a Money in the base currency to the quote currency", () => {
    const rate = ExchangeRate.of("USD", "EUR", "0.9");
    const out = rate.convert(Money.of("100", "USD"));
    expect(out.currency).toBe("EUR");
    expect(out.toString()).toBe("90");
  });

  it("converts across differing minor units at full precision", () => {
    const rate = ExchangeRate.of("USD", "JPY", "150.25");
    const out = rate.convert(Money.of("2", "USD"));
    expect(out.currency).toBe("JPY");
    expect(out.toString()).toBe("300.5");
  });

  it("supports the convert-then-round-at-the-edge pattern (whole yen)", () => {
    const rate = ExchangeRate.of("USD", "JPY", "150.25");
    expect(rate.convert(Money.of("2", "USD")).round().toString()).toBe("300");
  });

  it("throws when the money is not in the base currency", () => {
    const rate = ExchangeRate.of("USD", "EUR", "0.9");
    expect(() => rate.convert(Money.of("100", "EUR"))).toThrow(CurrencyMismatchError);
  });

  it("inverts and round-trips an exact rate", () => {
    const rate = ExchangeRate.of("USD", "EUR", "2");
    const inv = rate.invert();
    expect(inv.base).toBe("EUR");
    expect(inv.quote).toBe("USD");
    expect(inv.rate.toString()).toBe("0.5");
    expect(inv.convert(rate.convert(Money.of("10", "USD"))).equals(Money.of("10", "USD"))).toBe(
      true,
    );
  });

  it("validates currencies and rejects non-positive / unparseable rates", () => {
    expect(() => ExchangeRate.of("US", "EUR", "1")).toThrow(InvalidCurrencyError);
    expect(() => ExchangeRate.of("USD", "EUR", "0")).toThrow(InvalidAmountError);
    expect(() => ExchangeRate.of("USD", "EUR", "-1")).toThrow(InvalidAmountError);
    expect(() => ExchangeRate.of("USD", "EUR", "abc")).toThrow(InvalidAmountError);
  });

  it("serializes to JSON", () => {
    expect(ExchangeRate.of("USD", "EUR", "0.9").toJSON()).toEqual({
      base: "USD",
      quote: "EUR",
      rate: "0.9",
    });
  });
});
