import { describe, it, expect } from "vitest";
import {
  MoneyError,
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidAmountError,
} from "./errors";

describe("money errors", () => {
  it("CurrencyMismatchError carries both currencies and extends MoneyError", () => {
    const err = new CurrencyMismatchError("USD", "EUR");
    expect(err).toBeInstanceOf(MoneyError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CurrencyMismatchError");
    expect(err.left).toBe("USD");
    expect(err.right).toBe("EUR");
    expect(err.message).toContain("USD");
    expect(err.message).toContain("EUR");
  });

  it("InvalidCurrencyError carries the offending code", () => {
    const err = new InvalidCurrencyError("XYZ");
    expect(err).toBeInstanceOf(MoneyError);
    expect(err.name).toBe("InvalidCurrencyError");
    expect(err.code).toBe("XYZ");
  });

  it("InvalidAmountError carries the offending value", () => {
    const err = new InvalidAmountError("not-a-number");
    expect(err).toBeInstanceOf(MoneyError);
    expect(err.name).toBe("InvalidAmountError");
    expect(err.value).toBe("not-a-number");
  });
});
