import { describe, it, expect, vi } from "vitest";
import { Money, Decimal } from "@sage/core";
import type {
  IMarketDataProvider,
  Quote,
  AssetProfile,
  PriceBar,
  Dividend,
} from "@sage/provider-interface";
import { CachingMarketDataProvider } from "./caching-provider";

function quote(symbol: string, price: string): Quote {
  return {
    symbol,
    price: Money.of(price, "USD"),
    asOf: new Date("2026-06-19"),
    previousClose: null,
  };
}

class CountingProvider implements IMarketDataProvider {
  calls = 0;
  historyCalls = 0;
  dividendCalls = 0;
  failNextHistory = false;
  getQuote(symbol: string): Promise<Quote> {
    this.calls += 1;
    return Promise.resolve(quote(symbol, "100"));
  }
  getHistoricalPrices(): Promise<PriceBar[]> {
    this.historyCalls += 1;
    if (this.failNextHistory) {
      this.failNextHistory = false;
      return Promise.reject(new Error("provider down"));
    }
    return Promise.resolve([]);
  }
  getDividendHistory(): Promise<Dividend[]> {
    this.dividendCalls += 1;
    return Promise.resolve([]);
  }
  searchSymbol(): Promise<never[]> {
    return Promise.resolve([]);
  }
  getAssetProfile(symbol: string): Promise<AssetProfile> {
    return Promise.resolve({
      symbol,
      name: "Test",
      exchange: "XNAS",
      currency: "USD",
      assetType: "stock",
      sector: null,
      industry: null,
      marketCap: null,
      peRatio: null,
      beta: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      dividendYield: null,
      payoutRatio: null,
      trailingAnnualDividend: null,
      website: null,
      description: null,
      ceo: null,
      fullTimeEmployees: null,
      ipoDate: null,
      country: null,
      countryIso: null,
      fund: null,
    });
  }
}

describe("CachingMarketDataProvider", () => {
  it("serves a cached quote within the TTL", async () => {
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    await cache.getQuote("AAPL");
    await cache.getQuote("AAPL");
    expect(inner.calls).toBe(1);
  });

  it("refetches after the TTL expires", async () => {
    const inner = new CountingProvider();
    let t = 0;
    const cache = new CachingMarketDataProvider(inner, 1000, () => t);
    await cache.getQuote("AAPL");
    t = 1500;
    await cache.getQuote("AAPL");
    expect(inner.calls).toBe(2);
  });

  it("caches per symbol", async () => {
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    await cache.getQuote("AAPL");
    await cache.getQuote("MSFT");
    expect(inner.calls).toBe(2);
  });

  it("dedupes concurrent quote fetches for the same symbol", async () => {
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    // The dashboard quotes every holding from two views in parallel; concurrent
    // misses must share one upstream fetch rather than each hitting the provider.
    await Promise.all([cache.getQuote("AAPL"), cache.getQuote("AAPL")]);
    expect(inner.calls).toBe(1);
  });

  it("serves cached historical bars for the same symbol and day window", async () => {
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    // Same calendar-day window at different times of day must share one entry:
    // callers pass `new Date()` as `to`, so an exact-timestamp key never hits.
    await cache.getHistoricalPrices(
      "AAPL",
      new Date("2026-01-01"),
      new Date("2026-07-11T09:00:00Z"),
    );
    await cache.getHistoricalPrices(
      "AAPL",
      new Date("2026-01-01"),
      new Date("2026-07-11T14:30:00Z"),
    );
    expect(inner.historyCalls).toBe(1);
  });

  it("does not pin an empty history result for the full TTL", async () => {
    // PersistedPriceProvider RESOLVES with `[]` — it does not reject — whenever
    // it is cold and its own attempt budget says not to fetch upstream yet.
    // `shared()` gives any RESOLVED value the full history TTL and only shortens
    // it for a rejection, so a single empty answer pinned "no data" under that
    // symbol|from|to key for fifteen minutes. /performance rendered "No
    // benchmark data for this window" and went on rendering it long after the
    // bars had landed — the same fifteen-minute pinning that
    // persisted-price-provider.ts rethrows transient failures to avoid, except
    // this path returns rather than throws, so that protection never applies.
    let bars: PriceBar[] = [];
    const inner: IMarketDataProvider = {
      getQuote: () => Promise.resolve(quote("^GSPC", "100")),
      getHistoricalPrices: () => Promise.resolve(bars),
      getDividendHistory: () => Promise.resolve([]),
      searchSymbol: () => Promise.resolve([]),
      getAssetProfile: () => Promise.reject(new Error("unused")),
    };
    let t = 0;
    const cache = new CachingMarketDataProvider(inner, 1000, () => t, 15 * 60_000);
    const from = new Date("2025-08-28");
    const to = new Date("2026-08-28");

    expect(await cache.getHistoricalPrices("^GSPC", from, to)).toHaveLength(0);

    bars = [
      {
        date: new Date("2026-08-27"),
        open: Money.of("1", "USD"),
        high: Money.of("1", "USD"),
        low: Money.of("1", "USD"),
        close: Money.of("1", "USD"),
        volume: new Decimal(0),
      },
    ];

    // Still memoized moments later — the empty answer is not thrown away, so
    // concurrent and rapid callers do not stampede the store.
    t = 30_000;
    expect(await cache.getHistoricalPrices("^GSPC", from, to)).toHaveLength(0);

    // But past the NEGATIVE TTL it is re-asked, rather than being pinned for
    // the full fifteen minutes. This is the whole bug: at t=61s the bars are
    // there, and before this fix the caller still saw none until t=15min.
    t = 61_000;
    expect(await cache.getHistoricalPrices("^GSPC", from, to)).toHaveLength(1);
  });

  it("keys the bar cache by symbol and window", async () => {
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    await cache.getHistoricalPrices("AAPL", new Date("2026-01-01"), new Date("2026-07-11"));
    await cache.getHistoricalPrices("MSFT", new Date("2026-01-01"), new Date("2026-07-11"));
    await cache.getHistoricalPrices("AAPL", new Date("2026-06-01"), new Date("2026-07-11"));
    expect(inner.historyCalls).toBe(3);
  });

  it("refetches bars after the history TTL expires", async () => {
    const inner = new CountingProvider();
    let t = 0;
    const cache = new CachingMarketDataProvider(inner, 1000, () => t, 5000);
    await cache.getHistoricalPrices("AAPL", new Date("2026-01-01"), new Date("2026-07-11"));
    t = 6000;
    await cache.getHistoricalPrices("AAPL", new Date("2026-01-01"), new Date("2026-07-11"));
    expect(inner.historyCalls).toBe(2);
  });

  it("caches a failed bar fetch briefly, then retries after the negative TTL", async () => {
    const inner = new CountingProvider();
    let t = 0;
    const cache = new CachingMarketDataProvider(inner, 1000, () => t, 5000);
    inner.failNextHistory = true;
    await expect(
      cache.getHistoricalPrices("AAPL", new Date("2026-01-01"), new Date("2026-07-11")),
    ).rejects.toThrow("provider down");
    // Within the negative TTL the same rejection is replayed without a refetch
    // — a symbol the provider cannot serve must not be re-tried per request.
    await expect(
      cache.getHistoricalPrices("AAPL", new Date("2026-01-01"), new Date("2026-07-11")),
    ).rejects.toThrow("provider down");
    expect(inner.historyCalls).toBe(1);
    t = 61_000;
    const bars = await cache.getHistoricalPrices(
      "AAPL",
      new Date("2026-01-01"),
      new Date("2026-07-11"),
    );
    expect(bars).toEqual([]);
    expect(inner.historyCalls).toBe(2);
  });

  it("dedupes concurrent fetches for the same bar window", async () => {
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    await Promise.all([
      cache.getHistoricalPrices("AAPL", new Date("2026-01-01"), new Date("2026-07-11")),
      cache.getHistoricalPrices("AAPL", new Date("2026-01-01"), new Date("2026-07-11")),
    ]);
    expect(inner.historyCalls).toBe(1);
  });

  it("serves cached dividend history within the TTL", async () => {
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    await cache.getDividendHistory("AAPL");
    await cache.getDividendHistory("AAPL");
    await cache.getDividendHistory("MSFT");
    expect(inner.dividendCalls).toBe(2);
  });

  it("drops every cached window for a symbol when history is required", async () => {
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    // Populate two different windows for the same symbol.
    await cache.getHistoricalPrices("AAPL", new Date("2024-01-01"), new Date("2024-06-01"));
    await cache.getHistoricalPrices("AAPL", new Date("2024-03-01"), new Date("2024-06-01"));
    const callsBefore = inner.historyCalls;

    await cache.getHistoricalPrices("AAPL", new Date("2024-01-01"), new Date("2024-06-01"), {
      requireFrom: new Date("2024-01-01"),
    });

    // Both original windows must now miss, not just the one that was re-asked.
    await cache.getHistoricalPrices("AAPL", new Date("2024-03-01"), new Date("2024-06-01"));
    expect(inner.historyCalls).toBe(callsBefore + 2);
  });

  it("does not cache a required fetch", async () => {
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    const opts = { requireFrom: new Date("2024-01-01") };

    await cache.getHistoricalPrices("AAPL", new Date("2024-01-01"), new Date("2024-06-01"), opts);
    await cache.getHistoricalPrices("AAPL", new Date("2024-01-01"), new Date("2024-06-01"), opts);

    expect(inner.historyCalls).toBe(2);
  });

  it("coalesces concurrent required fetches for the same symbol", async () => {
    // Two tabs loading /performance at once must not both reach upstream for
    // every short symbol. Thirty holdings would become sixty calls against a
    // tier that allows twenty a day. The required path bypasses `shared()`, so
    // it needs its own in-flight de-duplication.
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    const opts = { requireFrom: new Date("2024-01-01") };

    await Promise.all([
      cache.getHistoricalPrices("AAPL", new Date("2024-01-01"), new Date("2024-06-01"), opts),
      cache.getHistoricalPrices("AAPL", new Date("2024-01-01"), new Date("2024-06-01"), opts),
      cache.getHistoricalPrices("AAPL", new Date("2024-01-01"), new Date("2024-06-01"), opts),
    ]);

    expect(inner.historyCalls).toBe(1);
  });

  it("drops a window cached DURING a required fetch, not just before it", async () => {
    // The repair writes bars the store lacked. A plain request that missed
    // while the repair was still in flight caches the pre-repair short history
    // under its own window key, and would serve it for the whole TTL --
    // re-pinning exactly what the repair just fixed. Invalidating only before
    // the fetch cannot catch that one.
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);

    const required = cache.getHistoricalPrices(
      "AAPL",
      new Date("2024-01-01"),
      new Date("2024-06-01"),
      { requireFrom: new Date("2024-01-01") },
    );
    // Races in alongside the repair, under a DIFFERENT window key.
    await cache.getHistoricalPrices("AAPL", new Date("2024-03-01"), new Date("2024-06-01"));
    await required;

    const before = inner.historyCalls;
    await cache.getHistoricalPrices("AAPL", new Date("2024-03-01"), new Date("2024-06-01"));
    expect(inner.historyCalls).toBe(before + 1); // re-fetched, not served stale
  });

  it("forwards cacheOnly to the inner provider instead of dropping it", async () => {
    // The plain window path used to build its cache
    // key and call `this.inner.getHistoricalPrices(symbol, from, to)` WITHOUT
    // `opts`, so a real dashboard request's `{ cacheOnly: true }` never
    // reached `PersistedPriceProvider` at all -- a cold benchmark still made
    // a real blocking upstream call. This pins the opts object at the call
    // boundary so a regression here fails fast, independent of the DB-backed
    // chain test in persisted-price-provider.integration.test.ts.
    const inner = new CountingProvider();
    const spy = vi.spyOn(inner, "getHistoricalPrices");
    const cache = new CachingMarketDataProvider(inner, 1000);
    const opts = { cacheOnly: true };
    const from = new Date("2024-01-01");
    const to = new Date("2024-06-01");

    await cache.getHistoricalPrices("AAPL", from, to, opts);

    expect(spy).toHaveBeenCalledWith("AAPL", from, to, opts);
  });

  it("forwards seedFrom on the PLAIN cached path, which cacheOnly never exercises", async () => {
    // `cacheOnly` and `requireFrom` both return before the memo, so the test
    // above passes through an early branch and says nothing about the path
    // every ordinary chart request takes. That path built its key and called
    // `this.inner.getHistoricalPrices(symbol, from, to)` with no `opts` at
    // all, so `seedFrom` was silently dropped and the valuation series got a
    // bar list that stopped at the window start — the fix for the first-day
    // hole worked in every integration test, against a provider chain that
    // did not include this class, and did nothing on the real endpoint.
    const inner = new CountingProvider();
    const spy = vi.spyOn(inner, "getHistoricalPrices");
    const cache = new CachingMarketDataProvider(inner, 1000);
    const from = new Date("2024-01-01");
    const to = new Date("2024-06-01");
    const opts = { seedFrom: new Date("2023-12-18") };

    await cache.getHistoricalPrices("AAPL", from, to, opts);

    expect(spy).toHaveBeenCalledWith("AAPL", from, to, opts);
  });

  it("keys the bar cache by seedFrom, so a wider read is not served a narrower one", async () => {
    // `seedFrom` changes the LENGTH of the returned array, so two callers
    // asking for the same window with different seeds must not share an entry
    // — an asset page would otherwise be handed the series' extra fortnight,
    // or the series handed the asset page's truncated list.
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    const from = new Date("2024-01-01");
    const to = new Date("2024-06-01");

    await cache.getHistoricalPrices("AAPL", from, to);
    await cache.getHistoricalPrices("AAPL", from, to, { seedFrom: new Date("2023-12-18") });

    expect(inner.historyCalls).toBe(2);
  });

  it("does not poison the shared cache with a cacheOnly result", async () => {
    // The cache key is `symbol|from|to` and does not encode `opts`. If a
    // cacheOnly call's `[]` were written into the shared map under that key,
    // a later PLAIN request for the identical window would read the `[]`
    // back instead of reaching upstream -- silently losing a benchmark for
    // the rest of the history TTL. This proves cacheOnly bypasses the map
    // entirely rather than merely happening to return the same answer.
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    const from = new Date("2024-01-01");
    const to = new Date("2024-06-01");

    await cache.getHistoricalPrices("AAPL", from, to, { cacheOnly: true });
    await cache.getHistoricalPrices("AAPL", from, to);

    // Both calls reached upstream: the second was not served a poisoned `[]`.
    expect(inner.historyCalls).toBe(2);
  });

  it("leaves another symbol's cache alone when a required fetch invalidates AAPL", async () => {
    const inner = new CountingProvider();
    const cache = new CachingMarketDataProvider(inner, 1000);
    await cache.getHistoricalPrices("MSFT", new Date("2024-01-01"), new Date("2024-06-01"));
    const callsBefore = inner.historyCalls;

    await cache.getHistoricalPrices("AAPL", new Date("2024-01-01"), new Date("2024-06-01"), {
      requireFrom: new Date("2024-01-01"),
    });
    await cache.getHistoricalPrices("MSFT", new Date("2024-01-01"), new Date("2024-06-01"));

    expect(inner.historyCalls).toBe(callsBefore + 1); // AAPL only; MSFT stayed cached
  });
});
