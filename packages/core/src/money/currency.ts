import { InvalidCurrencyError } from "./errors";

/** An ISO 4217 currency code, validated at construction (e.g. "USD", "JPY"). */
export type CurrencyCode = string;

const SUPPORTED: ReadonlySet<string> = new Set(Intl.supportedValuesOf("currency"));
const minorUnitsCache = new Map<string, number>();

/** True if `code` is a supported ISO 4217 currency code. */
export function isValidCurrency(code: string): boolean {
  return SUPPORTED.has(code);
}

/** Throws {@link InvalidCurrencyError} if `code` is not a supported ISO 4217 code. */
export function assertValidCurrency(code: string): asserts code is CurrencyCode {
  if (!SUPPORTED.has(code)) {
    throw new InvalidCurrencyError(code);
  }
}

/** Minor-unit (decimal place) count for a currency, e.g. USD→2, JPY→0, KWD→3. Cached. */
export function getMinorUnits(code: CurrencyCode): number {
  const cached = minorUnitsCache.get(code);
  if (cached !== undefined) {
    return cached;
  }
  assertValidCurrency(code);
  // `style: "currency"` always resolves maximumFractionDigits; the `?? 2` is a
  // type-level fallback only (the lib types allow `undefined` in general).
  const units =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  minorUnitsCache.set(code, units);
  return units;
}
