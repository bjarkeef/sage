import { sql } from "drizzle-orm";
import type { RateDay } from "@sage/provider-ecb";
import type { Database } from "../db/client";
import { fxRateDaily } from "../db/schema";

/** Rows per INSERT. Keeps the full-history seed (~220k rows) off one statement. */
const CHUNK_SIZE = 5000;

/** Minimum gap between refresh attempts. Sage does not model the TARGET holiday
 *  calendar — knowing whether ECB *should* have published today would require
 *  one — so attempts are simply rate-limited. On a weekend this costs a handful
 *  of 1.5 KB requests per day that return nothing new. */
const ATTEMPT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** First publication day of ECB's euro reference series. No feed reaches
 *  earlier, so no coverage rule may ask for earlier. */
export const ECB_SERIES_START = "1999-01-04";

/**
 * How far back stored coverage must reach before the full-history seed counts
 * as having landed.
 *
 * The number is deliberately NOT "back to 1999". What matters is whether this
 * instance can price the dates its charts actually plot, and no realistic
 * portfolio history predates twenty years. It also sits unambiguously between
 * the two shapes storage can take: the daily and 90-day feeds can only ever
 * produce ~90 days of coverage, while a completed full-history seed produces
 * coverage back to {@link ECB_SERIES_START}. Anything in between is evidence
 * that a full seed started and did not finish — the exact state that used to be
 * permanent, because feed choice looked only at `max(date)`, which the blocking
 * daily fetch had already pushed to today.
 */
export const REQUIRED_COVERAGE_YEARS = 20;

/** The subset of `EcbFxFeed` this module needs, so tests can pass a stub. */
export interface RateFeed {
  fetchDaily(): Promise<RateDay[]>;
  fetchRecent(): Promise<RateDay[]>;
  fetchFullHistory(): Promise<RateDay[]>;
}

let inFlight = false;
let lastAttemptAt = 0;

/** Clears module-level throttle state. Tests only. */
export function resetEcbSyncStateForTests(): void {
  inFlight = false;
  lastAttemptAt = 0;
}

/**
 * Earliest date stored coverage has to reach for the full-history seed to count
 * as landed: {@link REQUIRED_COVERAGE_YEARS} before `today`, but never earlier
 * than {@link ECB_SERIES_START} — demanding rows ECB never published would make
 * the rule permanently unsatisfiable.
 */
export function requiredCoverageFrom(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - REQUIRED_COVERAGE_YEARS);
  const wanted = d.toISOString().slice(0, 10);
  return wanted < ECB_SERIES_START ? ECB_SERIES_START : wanted;
}

/**
 * Which feed to pull, given what is already stored.
 *
 * Both ends of stored coverage matter. `latest` decides how far behind the tail
 * is; `earliest` decides whether the history is there at all. Judging by
 * `latest` alone made an interrupted seed permanent: the daily feed is stored
 * first, so `max(date)` jumps to today even when the full history that follows
 * never lands, and every later call then sees a current-looking table.
 *
 * @param latest Newest stored publication date, or null when nothing is stored.
 * @param earliest Oldest stored publication date, or null when nothing is stored.
 * @param today Today's UTC date as `YYYY-MM-DD`.
 */
export function chooseFeed(
  latest: string | null,
  earliest: string | null,
  today: string,
): "none" | "daily-then-full" | "backfill" | "recent" | "full" {
  if (latest === null || earliest === null) return "daily-then-full";
  // Checked before the tail: the full-history file carries the recent days too,
  // so a backfill subsumes whatever "recent" or "full" would have fetched.
  if (earliest > requiredCoverageFrom(today)) return "backfill";
  if (latest >= today) return "none";
  const gapDays = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / 86_400_000,
  );
  return gapDays <= 90 ? "recent" : "full";
}

/**
 * Upserts parsed rate-days, chunked. Idempotent: re-storing the same day
 * overwrites rather than duplicating, so any feed can be replayed safely.
 *
 * @returns The number of (date, currency) rows written.
 */
export async function storeRateDays(db: Database, days: RateDay[]): Promise<number> {
  const values = days.flatMap((day) =>
    [...day.ratesPerEur].map(([currency, rate]) => ({
      date: day.date,
      currency,
      rate: rate.toString(),
    })),
  );
  for (let i = 0; i < values.length; i += CHUNK_SIZE) {
    await db
      .insert(fxRateDaily)
      .values(values.slice(i, i + CHUNK_SIZE))
      .onConflictDoUpdate({
        target: [fxRateDaily.date, fxRateDaily.currency],
        set: { rate: sql`excluded.rate` },
      });
  }
  return values.length;
}

async function latestStoredDate(db: Database): Promise<string | null> {
  const [row] = await db.select({ date: sql<string>`max(${fxRateDaily.date})` }).from(fxRateDaily);
  return row?.date ?? null;
}

/**
 * Oldest publication day stored in `fx_rate_daily`; null when the table is
 * empty. Describes how far back the ECB series reaches on this instance.
 */
export async function earliestStoredDate(db: Database): Promise<string | null> {
  const [row] = await db.select({ date: sql<string>`min(${fxRateDaily.date})` }).from(fxRateDaily);
  return row?.date ?? null;
}

/**
 * Runs the full-history seed off the request path and takes ownership of the
 * `inFlight` flag: the caller must not clear it.
 *
 * Wrapped in an async IIFE rather than chained onto `feed.fetchFullHistory()`
 * directly, because {@link RateFeed} permits a SYNCHRONOUS throw. Thrown
 * outside a promise chain it would escape past the `finally` below and leave
 * `inFlight` stuck true, wedging every future refresh for the life of the
 * process.
 */
function seedFullHistoryInBackground(db: Database, feed: RateFeed): void {
  void (async () => {
    try {
      // A first boot downloads and inserts the whole ECB series — over 200k
      // rows — behind the response, and said nothing at all while doing it.
      // Two lines, so someone watching `docker compose logs` on a first start
      // can tell "downloading history" from "wedged".
      console.log("[fx] seeding ECB rate history in the background…");
      const started = Date.now();
      const days = await feed.fetchFullHistory();
      await storeRateDays(db, days);
      console.log(
        `[fx] ECB history seeded: ${days.length} days in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } catch {
      // Seed failed; the next attempt past the throttle window retries. Spot
      // rates already work.
      console.warn("[fx] ECB history seed failed; spot rates still work, will retry");
    } finally {
      inFlight = false;
    }
  })();
}

/**
 * Brings stored rates up to date, awaiting only what first paint needs.
 *
 * On an empty table this blocks on the ~1.5 KB daily feed so the very first
 * render carries correct spot rates, then seeds the ~951 KB full history in the
 * background — where a 220k-row insert cannot delay a response. Incremental
 * catch-up never blocks at all.
 *
 * A table whose history is missing (an interrupted seed) is re-seeded the same
 * way: in the background, never blocking, because spot rates are already there
 * and boot must not wait on a 951 KB fetch.
 */
export async function ensureRatesAvailable(db: Database, feed: RateFeed): Promise<void> {
  if (inFlight) return;
  // Set before the first `await` below, not after: `latestStoredDate` is a
  // real DB round-trip that yields the event loop, and two calls arriving
  // close together (very plausible right after a deploy against an unseeded
  // table) would otherwise both pass the guard above and both seed.
  inFlight = true;
  const now = Date.now();
  // Set once a background chain has taken ownership of `inFlight`; the
  // `finally` below must then leave the flag alone.
  let backgrounded = false;
  try {
    const [latest, earliest] = await Promise.all([latestStoredDate(db), earliestStoredDate(db)]);
    // The throttle guards network chatter, not the cold-start seed: an empty
    // table must always be filled, however recently we tried.
    if (latest !== null && now - lastAttemptAt < ATTEMPT_INTERVAL_MS) return;

    const mode = chooseFeed(latest, earliest, new Date().toISOString().slice(0, 10));
    if (mode === "none") return;

    lastAttemptAt = now;
    if (mode === "daily-then-full") {
      try {
        await storeRateDays(db, await feed.fetchDaily());
      } catch (err) {
        // The background chain below was never launched, so nothing else
        // would ever clear `inFlight` -- release it here before rethrowing.
        inFlight = false;
        throw err;
      }
      backgrounded = true;
      seedFullHistoryInBackground(db, feed);
      return; // `inFlight` is cleared by the background chain above.
    }
    if (mode === "backfill") {
      backgrounded = true;
      seedFullHistoryInBackground(db, feed);
      return; // `inFlight` is cleared by the background chain above.
    }
    const days = mode === "recent" ? await feed.fetchRecent() : await feed.fetchFullHistory();
    await storeRateDays(db, days);
  } finally {
    if (!backgrounded) inFlight = false;
  }
}

/** Fire-and-forget wrapper for request paths. Never rejects. */
export function triggerEcbRefresh(db: Database, feed: RateFeed): void {
  void ensureRatesAvailable(db, feed).catch(() => {
    // FX refresh is best-effort; views already degrade honestly without it.
  });
}
