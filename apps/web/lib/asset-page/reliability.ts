import { formatDate } from "../format";
import type { AssetDetailDTO, AssetDividendsDTO, MoneyDTO } from "../types";

/** A figure shown but not trusted; the page draws a muted "check" marker whose
 *  hover is `reason`. */
export interface Flag {
  reason: string;
}

export const STALE_AFTER_DAYS = 7;
/** 300%, as a fraction. */
export const PAYOUT_MAX = 3;
export const YIELD_RANGE_MAX_RATIO = 5;
export const PER_SHARE_JUMP_MAX = 3;
/** Rounding allowance when two producers' sums are compared. */
export const TRAILING_TOLERANCE = 0.005;
export const YIELD_TOLERANCE = 1e-6;

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
}

/** "as of May 3, 2026" once a provider snapshot is more than 7 days old; null
 *  while fresh or when the date is unknown. */
export function staleAsOf(asOf: string | null, todayISO: string): string | null {
  if (!asOf) return null;
  const dayIso = asOf.slice(0, 10);
  return daysBetween(dayIso, todayISO) > STALE_AFTER_DAYS
    ? `as of ${formatDate(dayIso, { year: "always" })}`
    : null;
}

export function payoutRatioFlag(ratio: number | null): Flag | null {
  if (ratio == null || (ratio >= 0 && ratio <= PAYOUT_MAX)) return null;
  return {
    reason: `A payout ratio of ${(ratio * 100).toFixed(0)}% is outside 0–300%: usually a loss year, a special dividend or a provider error.`,
  };
}

export function peFlag(pe: number | null): Flag | null {
  if (pe == null || pe > 0) return null;
  return {
    reason: "A P/E of zero or below: a loss, or no figure from the provider.",
  };
}

export function yieldRangeFlag(range: { low: number; high: number } | null): Flag | null {
  if (!range || range.high <= YIELD_RANGE_MAX_RATIO * range.low) return null;
  return {
    reason:
      "The high is more than 5× the low: usually a special dividend, a split, a suspension or a unit error in the provider's data.",
  };
}

/** Sums of decimals drift in binary (3 × 1.2 is 3.5999999999999996); compare at 6 dp. */
export const round6 = (n: number): number => Number(n.toFixed(6));

export function perShareJumpFlag(total: number, previous: number | null): Flag | null {
  if (previous == null || previous <= 0 || round6(total) <= round6(PER_SHARE_JUMP_MAX * previous))
    return null;
  return {
    reason:
      "More than 3× the year before: usually a special dividend, a split or a unit error in the provider's data.",
  };
}

/** Per-share dividends with an ex-date in (today − 1 calendar year, today] —
 *  the window the endpoint's `annualDividend` uses. */
export function trailingSum(
  history: AssetDividendsDTO["history"],
  currency: string,
  todayISO: string,
): number {
  const yearAgo = `${Number(todayISO.slice(0, 4)) - 1}${todayISO.slice(4)}`;
  return history
    .filter((h) => h.currency === currency && h.exDate > yearAgo && h.exDate <= todayISO)
    .reduce((s, h) => s + Number(h.amountPerShare), 0);
}

/** Consistency check: the payments the per-year bars are built from, over the
 *  trailing 12 months, add up to the endpoint's `annualDividend`. */
export function checkTrailingSum(
  history: AssetDividendsDTO["history"],
  annualDividend: MoneyDTO | null,
  todayISO: string,
): { ok: boolean; trailing: number; annual: number | null } {
  if (!annualDividend) {
    return {
      ok: true,
      trailing: trailingSum(history, history[0]?.currency ?? "", todayISO),
      annual: null,
    };
  }
  const trailing = trailingSum(history, annualDividend.currency, todayISO);
  const annual = Number(annualDividend.amount);
  return { ok: Math.abs(trailing - annual) <= TRAILING_TOLERANCE, trailing, annual };
}

/** Consistency check: current yield = trailing dividend ÷ the header price. */
export function checkCurrentYield(
  currentYield: number | null,
  annualDividend: MoneyDTO | null,
  quote: AssetDetailDTO["quote"],
): boolean {
  if (currentYield == null || !annualDividend || !quote) return true;
  if (annualDividend.currency !== quote.price.currency) return false;
  const expected = Number(annualDividend.amount) / Number(quote.price.amount);
  return Math.abs(expected - currentYield) <= YIELD_TOLERANCE;
}
