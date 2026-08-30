import { describe, it, expect } from "vitest";
import {
  Money,
  ExchangeRate,
  Decimal,
  DEFAULT_ROUNDING,
  isValidCurrency,
  getMinorUnits,
  MoneyError,
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidAmountError,
  SAGE_CORE_VERSION,
} from "./index";

describe("@sage/core public surface", () => {
  it("re-exports the money foundation and the version constant", () => {
    expect(typeof SAGE_CORE_VERSION).toBe("string");
    expect(Money.of("1", "USD").currency).toBe("USD");
    expect(ExchangeRate.of("USD", "EUR", "1").base).toBe("USD");
    expect(new Decimal("1").toString()).toBe("1");
    expect(DEFAULT_ROUNDING).toBe("half-even");
    expect(isValidCurrency("USD")).toBe(true);
    expect(getMinorUnits("USD")).toBe(2);
    expect(new CurrencyMismatchError("USD", "EUR")).toBeInstanceOf(MoneyError);
    expect(new InvalidCurrencyError("X")).toBeInstanceOf(MoneyError);
    expect(new InvalidAmountError("x")).toBeInstanceOf(MoneyError);
  });
});
