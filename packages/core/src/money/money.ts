import { Decimal, DEFAULT_ROUNDING, ROUNDING_MODES, type RoundingMode } from "./decimal";
import { assertValidCurrency, getMinorUnits, type CurrencyCode } from "./currency";
import { CurrencyMismatchError, InvalidAmountError, MoneyError } from "./errors";

/** Parse a money amount, rejecting native numbers and non-finite values. */
function parseAmount(value: string | Decimal): Decimal {
  if (typeof value === "number") {
    throw new InvalidAmountError(value);
  }
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    throw new InvalidAmountError(value);
  }
  if (!d.isFinite()) {
    throw new InvalidAmountError(value);
  }
  return d;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * An immutable monetary value: an exact decimal amount in a single currency.
 * Holds full precision internally; rounding to minor units is explicit.
 */
export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: CurrencyCode,
  ) {}

  /** Construct from a decimal string or {@link Decimal}. Never accepts a native number. */
  static of(amount: string | Decimal, currency: string): Money {
    assertValidCurrency(currency);
    return new Money(parseAmount(amount), currency);
  }

  /** A zero amount in the given currency. */
  static zero(currency: string): Money {
    assertValidCurrency(currency);
    return new Money(new Decimal(0), currency);
  }

  /** Reconstruct from {@link Money.toJSON} output. */
  static fromJSON(json: { amount: string; currency: string }): Money {
    return Money.of(json.amount, json.currency);
  }

  /**
   * Sum a list of same-currency Money values. An empty list requires an explicit
   * `currency` (a sum of nothing has no currency to infer) and yields zero.
   */
  static sum(items: Money[], currency?: CurrencyCode): Money {
    if (items.length === 0) {
      if (currency === undefined) {
        throw new MoneyError("Money.sum of an empty list requires an explicit currency");
      }
      return Money.zero(currency);
    }
    return items.reduce((acc, item) => acc.plus(item));
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  times(factor: string | Decimal): Money {
    return new Money(this.amount.times(parseAmount(factor)), this.currency);
  }

  dividedBy(divisor: string | Decimal): Money {
    const d = parseAmount(divisor);
    if (d.isZero()) {
      // Guard at the call site: dividing by zero would yield a non-finite
      // amount that silently corrupts every downstream operation.
      throw new InvalidAmountError(divisor);
    }
    return new Money(this.amount.dividedBy(d), this.currency);
  }

  negated(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  compareTo(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.amount.comparedTo(other.amount) as -1 | 0 | 1;
  }

  equals(other: Money): boolean {
    return other.currency === this.currency && this.amount.equals(other.amount);
  }

  lessThan(other: Money): boolean {
    return this.compareTo(other) < 0;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compareTo(other) <= 0;
  }

  greaterThan(other: Money): boolean {
    return this.compareTo(other) > 0;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compareTo(other) >= 0;
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isPositive(): boolean {
    return this.amount.greaterThan(0);
  }

  isNegative(): boolean {
    return this.amount.lessThan(0);
  }

  /** Round the amount to the currency's minor units (banker's rounding by default). */
  round(mode: RoundingMode = DEFAULT_ROUNDING): Money {
    const dp = getMinorUnits(this.currency);
    return new Money(this.amount.toDecimalPlaces(dp, ROUNDING_MODES[mode]), this.currency);
  }

  /**
   * Distribute this amount (rounded to minor units) across `weights` using the
   * largest-remainder method, so the parts sum exactly to the rounded original.
   *
   * Tie-break: when two parts have equal fractional remainders, the leftover
   * minor unit goes to the earlier (lower-index) weight first. This is stable
   * and deterministic — relevant when allocation order maps to real parties.
   */
  allocate(weights: number[]): Money[] {
    if (weights.length === 0 || weights.some((w) => !Number.isFinite(w) || w < 0)) {
      throw new InvalidAmountError(weights);
    }
    const totalWeightNum = weights.reduce((a, b) => a + b, 0);
    if (totalWeightNum <= 0) {
      throw new InvalidAmountError(weights);
    }

    const dp = getMinorUnits(this.currency);
    const factor = new Decimal(10).pow(dp);
    const totalMinor = this.amount
      .times(factor)
      .toDecimalPlaces(0, ROUNDING_MODES[DEFAULT_ROUNDING]);
    const totalWeight = new Decimal(totalWeightNum);

    const exact = weights.map((w) => totalMinor.times(new Decimal(w)).dividedBy(totalWeight));
    const bases = exact.map((e) => e.toDecimalPlaces(0, ROUNDING_MODES.down)); // truncate toward zero
    const allocated = bases.reduce((a, b) => a.plus(b), new Decimal(0));
    const remainder = totalMinor.minus(allocated); // integer; sign follows the total

    const order = exact
      .map((e, i) => ({ i, frac: e.minus(bases[i] ?? new Decimal(0)).abs() }))
      .sort((a, b) => b.frac.comparedTo(a.frac));

    const result = bases.slice();
    const step = remainder.isNegative() ? new Decimal(-1) : new Decimal(1);
    // `remainder` is a small integer (|remainder| < weights.length) by the
    // largest-remainder method, so toNumber() here is safe as a loop counter.
    let leftover = remainder.abs().toNumber();
    let k = 0;
    while (leftover > 0) {
      const entry = order[k % order.length];
      if (entry) {
        const target = entry.i;
        const current = result[target] ?? new Decimal(0);
        result[target] = current.plus(step);
      }
      leftover -= 1;
      k += 1;
    }

    return result.map((minor) => new Money(minor.dividedBy(factor), this.currency));
  }

  /** Split this amount into `n` as-equal-as-possible parts that sum exactly to it. */
  split(n: number): Money[] {
    if (!Number.isInteger(n) || n <= 0) {
      throw new InvalidAmountError(n);
    }
    return this.allocate(new Array<number>(n).fill(1));
  }

  /** Exact decimal string (no exponential notation), suitable for a `numeric` column. */
  toString(): string {
    return this.amount.toFixed();
  }

  toJSON(): { amount: string; currency: CurrencyCode } {
    return { amount: this.amount.toFixed(), currency: this.currency };
  }

  /** Escape hatch to the underlying decimal. */
  toDecimal(): Decimal {
    return this.amount;
  }

  /** Localized currency string via Intl (display only; rounds to minor units). */
  format(locale?: string, options?: Intl.NumberFormatOptions): string {
    const key = `${locale ?? ""}|${this.currency}|${options ? JSON.stringify(options) : ""}`;
    let formatter = formatterCache.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: this.currency,
        ...options,
      });
      formatterCache.set(key, formatter);
    }
    // toNumber is acceptable here: display only, and Intl rounds to minor units.
    return formatter.format(this.amount.toNumber());
  }
}
