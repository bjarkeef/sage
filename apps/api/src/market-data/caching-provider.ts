import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
  HistoryOptions,
} from "@sage/provider-interface";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Wraps an {@link IMarketDataProvider}, caching the expensive read paths:
 *
 * - `getQuote` per symbol for `quoteTtlMs` (default 60s — quotes move).
 * - `getHistoricalPrices` per symbol + calendar-day window for `historyTtlMs`
 *   (default 15min — only today's partial bar can change, and every valuation
 *   endpoint refetches the FULL history of EVERY symbol per request without
 *   this). Keys use day granularity because callers pass `new Date()` as `to`;
 *   an exact-timestamp key would never hit.
 * - `getDividendHistory` per symbol for `historyTtlMs`.
 *
 * All three store the in-flight promise, so concurrent requests for the same
 * key share one upstream fetch — the dashboard builds the portfolio and
 * diversification views in parallel and both quote every holding, so without
 * quote coalescing that would be two upstream quote calls per symbol.
 * Rejections are kept
 * for a short negative TTL: benchmark lookups probe symbol variants that some
 * providers can never serve, and without negative caching every request
 * re-pays that failing round-trip. A real outage still self-heals within
 * `NEGATIVE_TTL_MS`. `searchSymbol` and `getAssetProfile` pass through
 * (profiles are persisted in the DB by their own layer). `now` is injectable
 * for deterministic tests.
 */
export class CachingMarketDataProvider implements IMarketDataProvider {
  private readonly quotes = new Map<string, CacheEntry<Promise<Quote>>>();
  private readonly history = new Map<string, CacheEntry<Promise<PriceBar[]>>>();
  /** Required (repair) fetches currently in flight, keyed by symbol. Not a
   *  cache — entries live only for the duration of the fetch. */
  private readonly requiredInFlight = new Map<string, Promise<PriceBar[]>>();
  private readonly dividends = new Map<string, CacheEntry<Promise<Dividend[]>>>();

  constructor(
    private readonly inner: IMarketDataProvider,
    private readonly quoteTtlMs = 60_000,
    private readonly now: () => number = () => Date.now(),
    private readonly historyTtlMs = 15 * 60_000,
  ) {}

  getQuote(symbol: string): Promise<Quote> {
    return this.shared(this.quotes, symbol, () => this.inner.getQuote(symbol), this.quoteTtlMs);
  }

  getHistoricalPrices(
    symbol: string,
    from: Date,
    to: Date,
    opts?: HistoryOptions,
  ): Promise<PriceBar[]> {
    // Bypass the shared history cache entirely rather than routing through
    // `shared()`. Two reasons, not one: (1) a cacheOnly call only ever reads
    // PersistedPriceProvider's local store -- it never pays for an upstream
    // fetch -- so there is nothing expensive here for the memo to protect
    // against; and (2) the cache key below is `symbol|from|to` and does NOT
    // encode `opts`, so writing a cacheOnly `[]` into that slot would let a
    // LATER plain request for the identical window read it back instead of
    // reaching upstream -- turning a dashboard optimisation into
    // `GET /performance` silently losing a benchmark for the rest of the
    // history TTL. See the "does not poison" test in caching-provider.test.ts.
    if (opts?.cacheOnly) {
      return this.inner.getHistoricalPrices(symbol, from, to, opts);
    }
    // A required fetch may write bars the store did not have. Entries cached
    // under OTHER windows -- the overview's YTD key, say -- would go on
    // serving the short history for the rest of their TTL, so the page that
    // repaired the data would be the only page to see the repair. Drop every
    // window for this symbol, and do not cache the result: a required fetch
    // is rare and already networked, so bypassing costs nothing.
    //
    // The key carries the window, so `this.history.delete(symbol)` would be a
    // silent no-op. It has to be a prefix scan.
    if (opts?.requireFrom !== undefined) {
      // Coalesce concurrent required fetches. Without this the required path
      // bypasses `shared()` entirely, so two tabs loading /performance at once
      // both reach upstream for every short symbol — thirty holdings becomes
      // sixty calls against a tier that allows twenty a day. Keyed on symbol
      // alone (not the window) because they are all filling the same gap, and
      // held only while in flight: this is de-duplication, not caching.
      const inFlight = this.requiredInFlight.get(symbol);
      if (inFlight) return inFlight;

      this.dropHistory(symbol);
      const pending = this.inner.getHistoricalPrices(symbol, from, to, opts).finally(() => {
        this.requiredInFlight.delete(symbol);
        // Drop AGAIN on settle, not only before the fetch. A plain request
        // that missed while the repair was in flight caches the pre-repair
        // short history under its own window key and would serve it for the
        // full TTL — re-pinning exactly what the repair just fixed.
        this.dropHistory(symbol);
      });
      this.requiredInFlight.set(symbol, pending);
      return pending;
    }
    const key = `${symbol}|${dayOf(from)}|${dayOf(to)}`;
    // An empty bar list is PROVISIONAL, not an answer. PersistedPriceProvider
    // resolves with `[]` — it does not reject — whenever it is cold and its
    // attempt budget says not to fetch upstream yet, so without this a single
    // empty read pinned "no data" for this window for the full history TTL.
    // That is how /performance kept rendering "No benchmark data for this
    // window" for fifteen minutes after the bars had actually landed. It is
    // the same pinning persisted-price-provider.ts rethrows transient failures
    // to avoid; that protection never applied here because this path returns
    // rather than throws.
    //
    // It still caches for the negative TTL, so rapid and concurrent callers are
    // memoized; it just stops being pinned for a quarter of an hour. Re-asking
    // costs nothing upstream either: `mayAttempt`/`REFRESH_BUDGET` still gate
    // every real fetch, so a genuinely empty symbol re-reads the local store.
    // Dividends keep the full TTL — for them `[]` is a real answer (a
    // non-payer), not a gap.
    return this.shared(
      this.history,
      key,
      () => this.inner.getHistoricalPrices(symbol, from, to),
      this.historyTtlMs,
      (bars) => bars.length === 0,
    );
  }

  /** Drop every cached window for one symbol. The key carries the window, so
   *  `this.history.delete(symbol)` would be a silent no-op — it has to scan. */
  private dropHistory(symbol: string): void {
    const prefix = `${symbol}|`;
    for (const key of this.history.keys()) {
      if (key.startsWith(prefix)) this.history.delete(key);
    }
  }

  getDividendHistory(symbol: string): Promise<Dividend[]> {
    return this.shared(this.dividends, symbol, () => this.inner.getDividendHistory(symbol));
  }

  searchSymbol(query: string): Promise<SearchResult[]> {
    return this.inner.searchSymbol(query);
  }

  getAssetProfile(symbol: string): Promise<AssetProfile> {
    return this.inner.getAssetProfile(symbol);
  }

  /** Promise-valued cache: a miss stores the fetch promise immediately so
   *  concurrent misses coalesce; a rejection shortens its own entry's expiry
   *  to the negative TTL (unless a newer fetch already replaced it).
   *
   *  `provisional` extends that same shortening to a RESOLVED value that is not
   *  really an answer — an empty bar list, which upstream returns rather than
   *  throws. It still caches, so concurrent and rapid callers are memoized, but
   *  for the negative TTL rather than the full one. Evicting outright was the
   *  other option and is worse: a symbol that genuinely has no bars would then
   *  never memoize at all and would reach the store on every request. */
  private shared<T>(
    map: Map<string, CacheEntry<Promise<T>>>,
    key: string,
    fetch: () => Promise<T>,
    ttlMs = this.historyTtlMs,
    provisional?: (value: T) => boolean,
  ): Promise<T> {
    const hit = map.get(key);
    if (hit && hit.expiresAt > this.now()) {
      return hit.value;
    }
    const value = fetch();
    map.set(key, { value, expiresAt: this.now() + ttlMs });
    // Identity-guarded: a newer fetch may already own this key, and it must not
    // have its expiry rewritten by an older promise settling late.
    const shorten = () => {
      const entry = map.get(key);
      if (entry?.value === value) {
        entry.expiresAt = Math.min(entry.expiresAt, this.now() + NEGATIVE_TTL_MS);
      }
    };
    value.then((resolved) => {
      if (provisional?.(resolved)) shorten();
    }, shorten);
    return value;
  }
}

/** How long a rejected fetch is replayed before the upstream is retried. */
const NEGATIVE_TTL_MS = 60_000;

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}
