import { Decimal } from "./decimal";
import { Money } from "./money";
import type { CurrencyCode } from "./currency";

/**
 * Minor-unit (sub-currency) codes that data providers report instead of the
 * ISO 4217 major unit, mapped to that major unit plus the divisor needed to
 * convert an amount. The most common is `GBp`/`GBX` (UK pence) → GBP / 100.
 *
 * Keys are matched case-sensitively first (Yahoo's `GBp`/`ZAc`/`ILa` use a
 * lower-case final letter to distinguish pence from pounds), then by an
 * upper-cased fallback so `GBX`/`gbx` from other providers also resolve.
 */
const MINOR_UNITS: Record<string, { major: CurrencyCode; divisor: number }> = {
  GBp: { major: "GBP", divisor: 100 }, // UK pence (Yahoo)
  GBX: { major: "GBP", divisor: 100 }, // UK pence (EODHD and others)
  ZAc: { major: "ZAR", divisor: 100 }, // South African cents (Yahoo)
  ZAX: { major: "ZAR", divisor: 100 }, // South African cents
  ILa: { major: "ILS", divisor: 100 }, // Israeli agorot (Yahoo)
  ILX: { major: "ILS", divisor: 100 }, // Israeli agorot
};

/**
 * Resolve a raw provider currency string into a major-unit ISO code and the
 * divisor to apply. A code that is already a major unit (or simply lower-cased,
 * e.g. `gbp`) is upper-cased and returned with a divisor of 1.
 */
export function normalizeMinorUnit(rawCurrency: string): {
  currency: CurrencyCode;
  divisor: Decimal;
} {
  const minor = MINOR_UNITS[rawCurrency] ?? MINOR_UNITS[rawCurrency.toUpperCase()];
  if (minor) {
    return { currency: minor.major, divisor: new Decimal(minor.divisor) };
  }
  return { currency: rawCurrency.toUpperCase(), divisor: new Decimal(1) };
}

/**
 * Build a {@link Money} from a provider amount and its raw currency string,
 * normalizing minor units (e.g. pence → pounds) to a major-unit ISO currency.
 * Throws {@link InvalidCurrencyError} for an unknown currency, exactly as
 * {@link Money.of} would.
 */
export function moneyFromMinorUnit(amount: string | Decimal, rawCurrency: string): Money {
  const { currency, divisor } = normalizeMinorUnit(rawCurrency);
  const money = Money.of(amount, currency);
  return divisor.equals(1) ? money : money.dividedBy(divisor);
}
