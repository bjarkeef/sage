import type { Quote, PriceBar, Dividend, SearchResult, AssetProfile } from "./types";

/** Per-call requirements a store-backed provider may honour. Optional, so every
 *  adapter satisfies the interface unchanged and only the persisting wrapper
 *  reads it. */
export interface HistoryOptions {
  /** Earliest date the caller REQUIRES a bar for. A store-first provider must
   *  await an upstream fetch rather than serving short history and refreshing
   *  behind the response. Omitted keeps today's behaviour.
   *
   *  This is deliberately NOT `from`: `from` is how much history the caller
   *  wants, `requireFrom` is how little it can correctly do without. A holding
   *  bought inside the window legitimately has no earlier bars. */
  requireFrom?: Date;
  /** Wall-clock ms on `Date.now()`'s scale after which no new upstream fetch
   *  may START. Whatever is unfetched stays short and the caller reports it.
   *
   *  Only honoured on the "some coverage already" path — a symbol the store
   *  has NEVER fetched blocks unconditionally regardless of this value (see
   *  `PersistedPriceProvider.getHistoricalPrices`'s `coverage === null`
   *  branch). A deadline alone cannot bound that case; use `cacheOnly`. */
  deadline?: number;
  /** Never wait on an upstream fetch inline, even for a symbol the store has
   *  never fetched at all — serve only what is already stored, which may be
   *  `[]`. For a caller that cannot afford to pay for a cold fetch inline (a
   *  page rendered inside a `Promise.all` with other views, none of which may
   *  hang on this one). Implies `requireFrom` is never honoured either: a
   *  caller asking to never block cannot also ask to block until required
   *  history arrives. Does not suppress a fire-and-forget background refresh
   *  — neither of already-covered-but-stale data, nor (as of the cold path
   *  fix) of a symbol the store has never fetched at all — because neither
   *  ever blocks the caller, so there is nothing for `cacheOnly` to protect
   *  against there. Without the cold-path refill, a symbol that only ever
   *  arrives via `cacheOnly` requests could never warm at all. */
  cacheOnly?: boolean;
}

/**
 * The contract every market-data provider implements. Adapters validate and map
 * their own raw API responses into these types; nothing else is required.
 */
export interface IMarketDataProvider {
  getQuote(symbol: string): Promise<Quote>;
  getHistoricalPrices(
    symbol: string,
    from: Date,
    to: Date,
    opts?: HistoryOptions,
  ): Promise<PriceBar[]>;
  getDividendHistory(symbol: string): Promise<Dividend[]>;
  searchSymbol(query: string): Promise<SearchResult[]>;
  getAssetProfile(symbol: string): Promise<AssetProfile>;
}
