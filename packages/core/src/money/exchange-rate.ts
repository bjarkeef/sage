import { Decimal } from "./decimal";
import { Money } from "./money";
import { assertValidCurrency, type CurrencyCode } from "./currency";
import { CurrencyMismatchError, InvalidAmountError } from "./errors";

/** Parse and validate an exchange rate: a finite, strictly positive decimal. */
function parseRate(value: string | Decimal): Decimal {
  if (typeof value === "number") {
    throw new InvalidAmountError(value);
  }
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    throw new InvalidAmountError(value);
  }
  if (!d.isFinite() || d.lessThanOrEqualTo(0)) {
    throw new InvalidAmountError(value);
  }
  return d;
}

/**
 * An immutable exchange rate from `base` to `quote`: 1 unit of `base` equals
 * `rate` units of `quote`. Pure — rate sourcing lives in a later slice.
 */
export class ExchangeRate {
  private constructor(
    readonly base: CurrencyCode,
    readonly quote: CurrencyCode,
    readonly rate: Decimal,
  ) {}

  static of(base: string, quote: string, rate: string | Decimal): ExchangeRate {
    assertValidCurrency(base);
    assertValidCurrency(quote);
    return new ExchangeRate(base, quote, parseRate(rate));
  }

  /** Convert a Money in `base` to `quote` (full precision; caller rounds at the edge). */
  convert(money: Money): Money {
    if (money.currency !== this.base) {
      throw new CurrencyMismatchError(this.base, money.currency);
    }
    return Money.of(money.toDecimal().times(this.rate), this.quote);
  }

  /** The inverse rate (quote→base). */
  invert(): ExchangeRate {
    return new ExchangeRate(this.quote, this.base, new Decimal(1).dividedBy(this.rate));
  }

  toJSON(): { base: CurrencyCode; quote: CurrencyCode; rate: string } {
    return { base: this.base, quote: this.quote, rate: this.rate.toFixed() };
  }
}
