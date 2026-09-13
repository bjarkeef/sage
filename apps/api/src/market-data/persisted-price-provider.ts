import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
  HistoryOptions,
} from "@sage/provider-interface";
import { SymbolNotFoundError } from "@sage/provider-interface";
import type { PriceStore } from "./price-store";
import { QUOTE_TTL_MS, BAR_TTL_MS, isFresh, hasCoverage, toIsoDay } from "./price-freshness";

/** One recorded history attempt: when it completed, and how far back the
 *  window it asked for reached. */
interface BarAttempt {
  at: number;
  /** `from.getTime()` of the requested window. */
  from: number;
}

/**
 * Last upstream history-fetch ATTEMPT per symbol that actually COMPLETED,
 * whether or not it wrote anything.
 *
 * "Completed" is deliberate: recorded when the fetch resolves with bars, with
 * zero bars, or with a definitive `SymbolNotFoundError` — never when it
 * merely throws a transient error. A symbol whose upstream returns zero bars
 * writes no rows, so `fetchedAt` never advances and a coverage-based rule
 * alone would refetch it on every single request forever, which is what this
 * throttle prevents. But recording an ATTEMPT before knowing the OUTCOME would
 * mean a five-second blip during a symbol's first chart load locks it out of
 * backfill for a full BAR_TTL_MS having never actually been served — that was
 * a real bug (see `mayAttempt`/`recordAttempt` below). Module-level and
 * in-memory, mirroring `ecb-sync`'s `lastAttemptAt`: resetting at boot costs
 * at most one extra attempt per symbol per restart.
 *
 * Keyed by symbol but carrying the requested `from`, because coverage is a
 * property of (symbol, window), not of a symbol: a 1M fetch satisfies the
 * throttle without satisfying an ALL window, and — since `to` is always `now`
 * and the newest stored bar is at best yesterday's close — it re-records on
 * every refresh, so keying on the symbol alone let the narrow window win every
 * day and the wide chart never extended past the narrow one's data. See
 * `mayAttempt`.
 */
const lastBarAttempt = new Map<string, BarAttempt>();

/**
 * Last upstream quote-refresh ATTEMPT per symbol, recorded BEFORE the fetch —
 * the opposite timing from `lastBarAttempt`, deliberately.
 *
 * The cold bars path returns its fetch result straight to the caller, so
 * recording before a failure would blind a chart the caller is waiting on.
 * Quote refresh is fire-and-forget and always serves the already-stored value
 * regardless of outcome, so throttling failed attempts is exactly the intent:
 * without this, a failed refresh never writes, `fetchedAt` never advances, and
 * every request past the TTL re-fires — 30 holdings behind a 60-second cache
 * during an outage sustains roughly 30 upstream calls a minute, against the
 * same EODHD 20-requests-per-day tier `REFRESH_BUDGET` exists for. When the
 * provider is healthy this changes nothing: a successful write advances
 * `fetchedAt`, and the TTL gate in `getQuote` already prevents re-firing.
 */
const lastQuoteAttempt = new Map<string, number>();

/**
 * Concurrent background history refreshes allowed across the process.
 *
 * History backfill is the expensive path — a full-history fetch per symbol —
 * and one dashboard load touches every holding at once. Without a cap, a
 * 30-holding portfolio would fire 30 simultaneous upstream requests on its
 * first load, which is exactly what EODHD's 20-requests-per-day free tier
 * cannot absorb. Matches `stale-sync.ts`'s budget of 5.
 *
 * Quote refresh is one cheap call and is deliberately NOT budgeted.
 */
const REFRESH_BUDGET = 5;
let refreshesInFlight = 0;

/**
 * Fire-and-forget background refreshes (quote and bars) currently in flight.
 *
 * Needed because a refresh's cleanup can land after the test — or request —
 * that started it has moved on. `resetPriceAttemptsForTests` zeroes counters
 * but cannot cancel work already in progress; without this set, a slow
 * refresh's `finally` decrement can run during a *later* test, driving its
 * freshly-reset counter negative. See `drainPriceRefreshesForTests`.
 */
const inFlightRefreshes = new Set<Promise<void>>();

/** Registers a fire-and-forget refresh so tests can drain it, and forgets it
 *  once settled.
 *
 *  `catch` BEFORE `finally`, and both on a derived promise that is then
 *  dropped: `p.finally(...)` returns a NEW promise that re-propagates any
 *  rejection, so `void p.finally(...)` leaves that derivative unhandled. The
 *  refresh bodies swallow their own errors today, but this is a long-running
 *  server where one leaked rejection is a process exit under Node's default
 *  `--unhandled-rejections=throw`. Neutralising it here keeps the guarantee at
 *  the registration point rather than in every caller. */
function trackRefresh(p: Promise<void>): void {
  inFlightRefreshes.add(p);
  void p.catch(() => {}).finally(() => inFlightRefreshes.delete(p));
}

/** Clears the attempt throttles and the in-flight counter. Tests only.
 *  Call {@link drainPriceRefreshesForTests} FIRST — this does not cancel
 *  refreshes already running, so resetting the counter out from under one
 *  lets its eventual decrement drive a later test's counter negative. */
export function resetPriceAttemptsForTests(): void {
  lastBarAttempt.clear();
  lastQuoteAttempt.clear();
  refreshesInFlight = 0;
}

/**
 * Awaits every currently in-flight background refresh (quote and bars).
 *
 * Loops until the set is empty rather than snapshotting once, because
 * draining can itself start new work — a refresh's completion is exactly what
 * makes a budget-skipped symbol eligible on the next call. Tests only.
 */
export async function drainPriceRefreshesForTests(): Promise<void> {
  while (inFlightRefreshes.size > 0) {
    await Promise.allSettled([...inFlightRefreshes]);
  }
}

/**
 * Serves prices from Postgres and refreshes them behind the response.
 *
 * Position in the chain is load-bearing:
 *
 *   CustomRouting → Caching → **PersistedPrice** → Fallback → HealthTracking(leaf)
 *
 * `CachingMarketDataProvider` stays OUTSIDE so it keeps coalescing concurrent
 * reads (the dashboard builds two views in parallel, both quoting every
 * holding). `FallbackMarketDataProvider` stays INSIDE so primary-then-Yahoo is
 * exhausted before anything is called a failure. `HealthTrackingProvider` stays
 * INSIDE so it records the cause BEFORE this class swallows the error — which
 * is how the UI can say "EODHD has spent its daily allowance" while still
 * showing prices.
 *
 * The result is that a provider outage stops being visible as missing data and
 * becomes visible only as an age.
 */
export class PersistedPriceProvider implements IMarketDataProvider {
  constructor(
    private readonly store: PriceStore,
    private readonly inner: IMarketDataProvider,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getQuote(symbol: string): Promise<Quote> {
    const stored = await this.store.readQuote(symbol);

    if (stored === null) {
      // Cold symbol: nothing to serve, so this one blocks. Errors propagate —
      // including SymbolNotFoundError, which must stay neutral.
      const fresh = await this.inner.getQuote(symbol);
      await this.store.writeQuote(fresh, new Date(this.now()));
      return fresh;
    }

    if (!isFresh(stored.fetchedAt, this.now(), QUOTE_TTL_MS)) {
      this.refreshQuoteInBackground(symbol);
    }
    return stored.quote;
  }

  async getHistoricalPrices(
    symbol: string,
    from: Date,
    to: Date,
    opts?: HistoryOptions,
  ): Promise<PriceBar[]> {
    const coverage = await this.store.coverage(symbol);
    // Every stored read below is widened by `seedFrom`; every COVERAGE decision
    // still uses `from`. That split is the whole point of the option — see
    // `HistoryOptions.seedFrom`.
    const readFrom = opts?.seedFrom !== undefined && opts.seedFrom < from ? opts.seedFrom : from;

    if (coverage === null) {
      // Nothing stored at all: block, as with a cold quote — unless the
      // caller has opted out of ever waiting on upstream. Unlike `deadline`
      // below, there is no "later attempt" to gate here: this IS the first
      // and only attempt, so the only way to keep it from blocking is to
      // never make it. See `HistoryOptions.cacheOnly`.
      if (opts?.cacheOnly) {
        // Never block -- but a symbol that only ever arrives via cacheOnly
        // requests (a fresh self-host whose only visitor is `/dashboard`)
        // would otherwise NEVER warm: nothing on this path ever reaches
        // upstream, so the comparison stays `relative: null` forever unless
        // someone separately happens to load `GET /performance`. Kick off
        // the same background refill the "some coverage already" branch
        // below uses -- budget- and throttle-gated exactly the same way, via
        // `mayAttempt`/`REFRESH_BUDGET` inside `refreshBarsInBackground` --
        // and return the empty read immediately either way.
        this.refreshBarsInBackground(symbol, from, to);
        return [];
      }
      if (!this.mayAttempt(symbol, from)) return [];
      try {
        const bars = await this.inner.getHistoricalPrices(symbol, from, to);
        await this.store.writeBars(symbol, bars, new Date(this.now()));
        // Completed — with bars or with zero — so the attempt counts.
        this.recordAttempt(symbol, from);
        return bars;
      } catch (error) {
        if (error instanceof SymbolNotFoundError) {
          // A definitive answer: do not re-ask.
          this.recordAttempt(symbol, from);
          throw error;
        }
        // Transient failure: do NOT record, so the next request retries — and
        // RETHROW rather than degrading to `[]` here. `CachingMarketDataProvider`
        // sits outside this class and caches a RESOLVED value for the full
        // 15-minute history TTL, so returning `[]` would pin an empty chart in
        // place for 15 minutes after the blip had already passed; only a
        // rejection gets its 60-second negative TTL. Every call site
        // (`valuation-series`, `asset`) already
        // catches and degrades to an empty series, so the user-visible result
        // is the same — it just recovers fifteen times sooner.
        throw error;
      }
    }

    const covered = hasCoverage(coverage.earliest, coverage.latest, from, to);
    const fresh = isFresh(coverage.newestFetchedAt, this.now(), BAR_TTL_MS);

    // The caller cannot do its job without history this far back, so serving
    // short and refreshing behind the response would hand it a wrong answer it
    // has no way to detect. Await instead. Note this tests the EARLIEST bound
    // only: `covered` also demands `latest >= to`, which is false on nearly
    // every request because the newest stored bar is yesterday's close, so
    // blocking on `covered` would block every request for every symbol.
    const required =
      !opts?.cacheOnly &&
      opts?.requireFrom !== undefined &&
      coverage.earliest > toIsoDay(opts.requireFrom);
    const beforeDeadline = opts?.deadline === undefined || this.now() < opts.deadline;

    if (required && beforeDeadline && this.mayAttempt(symbol, from)) {
      try {
        const bars = await this.inner.getHistoricalPrices(symbol, from, to);
        await this.store.writeBars(symbol, bars, new Date(this.now()));
        this.recordAttempt(symbol, from);
      } catch (error) {
        // Serve what is stored either way: the caller reports the symbol short,
        // which is strictly better than failing the whole page. Only a
        // definitive answer is recorded, matching the cold path's reasoning.
        if (error instanceof SymbolNotFoundError) this.recordAttempt(symbol, from);
      }
      return this.store.readBars(symbol, readFrom, to);
    }

    if (!covered || !fresh) {
      this.refreshBarsInBackground(symbol, from, to);
    }
    return this.store.readBars(symbol, readFrom, to);
  }

  getDividendHistory(symbol: string): Promise<Dividend[]> {
    return this.inner.getDividendHistory(symbol);
  }

  searchSymbol(query: string): Promise<SearchResult[]> {
    return this.inner.searchSymbol(query);
  }

  getAssetProfile(symbol: string): Promise<AssetProfile> {
    return this.inner.getAssetProfile(symbol);
  }

  /** True when this call may hit upstream for `symbol`'s history: never
   *  attempted, its last COMPLETED attempt is more than BAR_TTL_MS old, or
   *  this window reaches strictly further back than that attempt's did.
   *
   *  The window clause is what keeps the throttle from starving a wide range:
   *  a satisfied 1M attempt says nothing about whether ALL has ever been
   *  fetched, and without it switching a chart to ALL could never extend past
   *  the 1M data. Asking again for the SAME window (or a narrower one) inside
   *  the TTL is still refused, which is the original purpose — a symbol whose
   *  upstream returns nothing must not loop.
   *
   *  Read-only — pairs with {@link recordAttempt}, the write, so a caller can
   *  check eligibility before a fetch and only record it once the outcome is
   *  known. */
  private mayAttempt(symbol: string, from: Date): boolean {
    const last = lastBarAttempt.get(symbol);
    if (last === undefined) return true;
    if (this.now() - last.at >= BAR_TTL_MS) return true;
    return from.getTime() < last.from;
  }

  /** Marks `symbol` as attempted just now for the window starting at `from`.
   *  Call only once the fetch's outcome is known to be a real answer (bars,
   *  zero bars, or SymbolNotFoundError) — never for a transient failure. */
  private recordAttempt(symbol: string, from: Date): void {
    lastBarAttempt.set(symbol, { at: this.now(), from: from.getTime() });
  }

  /** Fire-and-forget. A failed refresh leaves the stored row standing, and
   *  HealthTrackingProvider has already recorded why. Throttled to one
   *  attempt per QUOTE_TTL_MS, recorded BEFORE the fetch — see
   *  `lastQuoteAttempt`'s doc comment for why that's the right asymmetry with
   *  the bars path. */
  private refreshQuoteInBackground(symbol: string): void {
    const lastAttempt = lastQuoteAttempt.get(symbol);
    if (lastAttempt !== undefined && this.now() - lastAttempt < QUOTE_TTL_MS) return;
    lastQuoteAttempt.set(symbol, this.now());

    trackRefresh(
      (async () => {
        try {
          const fresh = await this.inner.getQuote(symbol);
          await this.store.writeQuote(fresh, new Date(this.now()));
        } catch {
          // Stored value stands; the cause is already in the health registry.
        }
      })(),
    );
  }

  private refreshBarsInBackground(symbol: string, from: Date, to: Date): void {
    // Budget BEFORE claiming the attempt, and the order matters: a symbol
    // skipped for budget must NOT be recorded as attempted, or it would be
    // locked out for a full BAR_TTL_MS despite never having been tried. Skipped
    // symbols simply get their turn on a later request, which is what makes
    // backfill converge over several page loads instead of stalling.
    if (refreshesInFlight >= REFRESH_BUDGET) return;
    if (!this.mayAttempt(symbol, from)) return;

    refreshesInFlight += 1;
    trackRefresh(
      (async () => {
        try {
          const bars = await this.inner.getHistoricalPrices(symbol, from, to);
          await this.store.writeBars(symbol, bars, new Date(this.now()));
          this.recordAttempt(symbol, from);
        } catch (error) {
          if (error instanceof SymbolNotFoundError) {
            this.recordAttempt(symbol, from);
          }
          // Otherwise: transient. Stored bars stand, and — same reasoning as
          // the cold path above — the attempt is NOT recorded, so the next
          // request gets another try instead of waiting out a full
          // BAR_TTL_MS for an outage that may already be over.
        } finally {
          refreshesInFlight -= 1;
        }
      })(),
    );
  }
}
