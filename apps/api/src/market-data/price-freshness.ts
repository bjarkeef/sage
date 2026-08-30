/**
 * Freshness and coverage decisions for the persistent price store.
 *
 * Pure and clock-injected so every rule can be tested without a database or a
 * fake timer.
 */

/** How old a stored quote may be before a background refresh is triggered.
 *  Not user-visible: a 15-minute-old price is served without comment, which is
 *  the trade that takes the network off the request path. */
export const QUOTE_TTL_MS = 15 * 60_000;

/** How old stored bars may be before a refetch, and how often a symbol whose
 *  upstream returns nothing is retried. A politeness budget toward the
 *  provider; not user-visible. */
export const BAR_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How old the OLDEST successful fetch may be before the user is warned.
 *
 * Deliberately a separate constant from {@link BAR_TTL_MS} despite sharing a
 * value: that one is a quota budget that a deployment might reasonably tune,
 * while this is a promise about when Sage admits it is flying blind. Collapsing
 * them would let a quota tweak silently change what the UI claims.
 */
export const PRICES_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in UTC, matching how Postgres `date` columns round-trip. */
export function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whether a stored row was fetched recently enough to serve without refreshing.
 *  A missing fetch is never fresh. */
export function isFresh(fetchedAt: Date | null, now: number, ttlMs: number): boolean {
  if (fetchedAt === null) return false;
  return now - fetchedAt.getTime() < ttlMs;
}

/**
 * Whether stored bars span the requested window.
 *
 * Compares range endpoints only — there is deliberately no check that every
 * trading day inside the window is present, because knowing which days SHOULD
 * exist would require modelling every exchange's holiday calendar. Gaps inside
 * a covered range are accepted; consumers already forward-fill.
 */
export function hasCoverage(
  earliest: string | null,
  latest: string | null,
  from: Date,
  to: Date,
): boolean {
  if (earliest === null || latest === null) return false;
  return earliest <= toIsoDay(from) && latest >= toIsoDay(to);
}

/** Whether the user should be told prices are out of date. Nothing stored is
 *  not staleness — a new instance has no prices yet and must not accuse itself. */
export function arePricesStale(oldestFetchedAt: Date | null, now: number): boolean {
  if (oldestFetchedAt === null) return false;
  return now - oldestFetchedAt.getTime() > PRICES_STALE_AFTER_MS;
}
