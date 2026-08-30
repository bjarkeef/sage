/** Base class for all money-related errors. */
export class MoneyError extends Error {}

/** Thrown when a binary operation requires two Money values of the same currency. */
export class CurrencyMismatchError extends MoneyError {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(`Currency mismatch: ${left} vs ${right}`);
    this.name = "CurrencyMismatchError";
  }
}

/** Thrown when a currency code is not a valid ISO 4217 code supported by the runtime. */
export class InvalidCurrencyError extends MoneyError {
  constructor(readonly code: string) {
    super(`Invalid or unsupported currency code: ${code}`);
    this.name = "InvalidCurrencyError";
  }
}

/** Thrown when an amount or rate cannot be parsed as a finite decimal. */
export class InvalidAmountError extends MoneyError {
  constructor(readonly value: unknown) {
    super(`Invalid amount: ${String(value)}`);
    this.name = "InvalidAmountError";
  }
}
