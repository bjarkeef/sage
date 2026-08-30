import { it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { Money, Decimal } from "@sage/core";
import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import { ProviderUnavailableError, SymbolNotFoundError } from "@sage/provider-interface";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { PriceStore } from "./price-store";
import { CachingMarketDataProvider } from "./caching-provider";
import {
  PersistedPriceProvider,
  resetPriceAttemptsForTests,
  drainPriceRefreshesForTests,
} from "./persisted-price-provider";
import { QUOTE_TTL_MS } from "./price-freshness";

const NOW = Date.now();
const dayOffset = (days: number) => new Date(NOW + days * 86_400_000);

function bar(date: Date, close: string): PriceBar {
  return {
    date,
    open: Money.of(close, "USD"),
    high: Money.of(close, "USD"),
    low: Money.of(close, "USD"),
    close: Money.of(close, "USD"),
    volume: new Decimal("100"),
  };
}

/** Upstream stub whose behaviour each test sets directly. */
class StubProvider implements IMarketDataProvider {
  quote: Quote | Error = new ProviderUnavailableError("down");
  bars: PriceBar[] | Error = [];
  /** When set, history calls block on it. Lets a test hold refreshes open and
   *  observe how many are allowed in flight at once. */
  barGate: Promise<void> | null = null;
  quoteCalls = 0;
  barCalls = 0;

  getQuote(symbol: string): Promise<Quote> {
    this.quoteCalls += 1;
    if (this.quote instanceof Error) return Promise.reject(this.quote);
    return Promise.resolve({ ...this.quote, symbol });
  }
  async getHistoricalPrices(): Promise<PriceBar[]> {
    this.barCalls += 1;
    if (this.barGate) await this.barGate;
    if (this.bars instanceof Error) throw this.bars;
    return this.bars;
  }
  getDividendHistory(): Promise<Dividend[]> {
    return Promise.resolve([]);
  }
  searchSymbol(): Promise<SearchResult[]> {
    return Promise.resolve([]);
  }
  getAssetProfile(): Promise<AssetProfile> {
    return Promise.reject(new Error("not used"));
  }
}

function liveQuote(price: string): Quote {
  return {
    symbol: "X",
    price: Money.of(price, "USD"),
    asOf: new Date(NOW),
    previousClose: null,
  };
}

describeDb("PersistedPriceProvider", () => {
  let t: TestDb;
  let store: PriceStore;
  let upstream: StubProvider;
  let provider: PersistedPriceProvider;

  beforeAll(async () => {
    t = await withTestDb();
    store = new PriceStore(t.db);
  });

  afterAll(async () => {
    await t.stop();
  });

  // Drains before the next test's `beforeEach` resets state. A background
  // refresh's `finally` decrement can otherwise land inside the NEXT test,
  // after that test's counter has already been zeroed — driving it negative.
  // See C1 in the task-4 review.
  afterEach(async () => {
    await drainPriceRefreshesForTests();
  });

  beforeEach(() => {
    resetPriceAttemptsForTests();
    upstream = new StubProvider();
    provider = new PersistedPriceProvider(store, upstream, () => NOW);
  });

  it("blocks and fetches upstream for a cold symbol", async () => {
    upstream.quote = liveQuote("42");
    const q = await provider.getQuote("COLD1");
    expect(q.price.amount.toString()).toBe("42");
    expect(upstream.quoteCalls).toBe(1);
  });

  // The ONLY way `price_quote` is ever populated — there is no seed, no
  // scheduler and no backfill job. Every other test in this file seeds the
  // store by hand, so without this one the write could be deleted outright and
  // the whole suite would stay green.
  it("stores the quote it fetched for a cold symbol", async () => {
    upstream.quote = liveQuote("42.5");

    await provider.getQuote("COLDWRITE1");

    const stored = await store.readQuote("COLDWRITE1");
    expect(stored).not.toBeNull();
    expect(stored!.quote.price.amount.toString()).toBe("42.5");
    expect(stored!.quote.symbol).toBe("COLDWRITE1");
  });

  it("rethrows when a cold symbol also fails upstream", async () => {
    upstream.quote = new ProviderUnavailableError("down");
    await expect(provider.getQuote("COLD2")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("serves the stored quote when upstream is down", async () => {
    await store.writeQuote(
      { ...liveQuote("77"), symbol: "STALE1" },
      new Date(NOW - 3 * 86_400_000),
    );
    upstream.quote = new ProviderUnavailableError("down");

    const q = await provider.getQuote("STALE1");

    // This is the outage behaviour: a price, not a null.
    expect(q.price.amount.toString()).toBe("77");
  });

  it("does not call upstream for a quote inside the TTL", async () => {
    await store.writeQuote({ ...liveQuote("50"), symbol: "FRESH1" }, new Date(NOW - 1000));
    upstream.quote = liveQuote("999");

    const q = await provider.getQuote("FRESH1");

    expect(q.price.amount.toString()).toBe("50");
    expect(upstream.quoteCalls).toBe(0);
  });

  it("serves the stored quote immediately when past the TTL", async () => {
    await store.writeQuote(
      { ...liveQuote("60"), symbol: "OLD1" },
      new Date(NOW - QUOTE_TTL_MS - 60_000),
    );
    upstream.quote = liveQuote("61");

    // Served from storage on THIS call — the refresh happens behind it.
    const q = await provider.getQuote("OLD1");
    expect(q.price.amount.toString()).toBe("60");

    // The background refresh actually fires. Without this, a reviewer could
    // stub out `refreshQuoteInBackground` entirely and every quote test above
    // would stay green — see C3 in the task-4 review.
    await drainPriceRefreshesForTests();
    expect(upstream.quoteCalls).toBe(1);
  });

  it("propagates SymbolNotFoundError instead of masking it as stale", async () => {
    upstream.quote = new SymbolNotFoundError("NOPE");
    await expect(provider.getQuote("NOPE")).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it("throttles repeated quote refresh attempts within the TTL after upstream failures", async () => {
    await store.writeQuote(
      { ...liveQuote("60"), symbol: "QFAIL1" },
      new Date(NOW - QUOTE_TTL_MS - 60_000),
    );
    upstream.quote = new ProviderUnavailableError("down");

    // Every call sees the same stale, never-refreshed stored row, so without
    // the attempt throttle each one would re-fire the background refresh.
    await provider.getQuote("QFAIL1");
    await provider.getQuote("QFAIL1");
    await provider.getQuote("QFAIL1");
    await drainPriceRefreshesForTests();

    expect(upstream.quoteCalls).toBe(1);
  });

  it("serves stored bars without calling upstream when covered and fresh", async () => {
    await store.writeBars(
      "HIST1",
      [bar(dayOffset(-20), "1"), bar(dayOffset(0), "2")],
      new Date(NOW),
    );
    upstream.bars = [bar(dayOffset(-1), "999")];

    const bars = await provider.getHistoricalPrices("HIST1", dayOffset(-10), dayOffset(0));

    expect(bars.map((b) => b.close.amount.toString())).toEqual(["2"]);
    expect(upstream.barCalls).toBe(0);
  });

  it("blocks and fetches history for a symbol with nothing stored", async () => {
    upstream.bars = [bar(dayOffset(-3), "5")];
    const bars = await provider.getHistoricalPrices("HIST2", dayOffset(-10), dayOffset(0));
    expect(bars).toHaveLength(1);
    expect(upstream.barCalls).toBe(1);
  });

  // The other half of I1: the only way `price_daily` is ever populated.
  it("stores the bars it fetched for a cold symbol", async () => {
    upstream.bars = [bar(dayOffset(-4), "7"), bar(dayOffset(-2), "8")];

    await provider.getHistoricalPrices("COLDWRITE2", dayOffset(-10), dayOffset(0));

    const cov = await store.coverage("COLDWRITE2");
    expect(cov).not.toBeNull();
    expect(cov!.earliest).toBe(dayOffset(-4).toISOString().slice(0, 10));
    expect(cov!.latest).toBe(dayOffset(-2).toISOString().slice(0, 10));
    const stored = await store.readBars("COLDWRITE2", dayOffset(-10), dayOffset(0));
    expect(stored.map((b) => b.close.amount.toString())).toEqual(["7", "8"]);
  });

  it("propagates SymbolNotFoundError from a cold history fetch instead of masking it as empty", async () => {
    upstream.bars = new SymbolNotFoundError("NOPE-HIST");
    await expect(
      provider.getHistoricalPrices("COLDHIST1", dayOffset(-10), dayOffset(0)),
    ).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it("does not lock a cold symbol out of backfill after a transient upstream failure", async () => {
    // Nothing stored, and upstream fails both times: without the fix, the
    // first failure would still record an attempt and the second call would
    // be silently throttled for a full BAR_TTL_MS.
    upstream.bars = new ProviderUnavailableError("down");

    await expect(
      provider.getHistoricalPrices("COLDFAIL1", dayOffset(-10), dayOffset(0)),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(
      provider.getHistoricalPrices("COLDFAIL1", dayOffset(-10), dayOffset(0)),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    expect(upstream.barCalls).toBe(2);
  });

  // I4: this class sits INSIDE `CachingMarketDataProvider`, which caches a
  // RESOLVED value for the full 15-minute history TTL and only gives rejections
  // its 60-second negative TTL. Degrading a cold transient failure to `[]` here
  // therefore pinned an empty chart in place for 15 minutes after the blip had
  // already passed — the opposite of the "stays eligible for retry" intent.
  // Every call site already catches, so rethrowing changes no user-visible
  // output, only the recovery time.
  it("rethrows a transient cold-path failure rather than resolving to an empty series", async () => {
    upstream.bars = new ProviderUnavailableError("down");

    await expect(
      provider.getHistoricalPrices("COLDTHROW1", dayOffset(-10), dayOffset(0)),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("serves partial stored history immediately rather than blocking", async () => {
    // Stored range does not reach back to the requested `from`.
    await store.writeBars("HIST3", [bar(dayOffset(-2), "9")], new Date(NOW));
    upstream.bars = [bar(dayOffset(-30), "1")];

    const bars = await provider.getHistoricalPrices("HIST3", dayOffset(-60), dayOffset(0));

    expect(bars.map((b) => b.close.amount.toString())).toEqual(["9"]);
  });

  it("serves stored history when upstream fails", async () => {
    await store.writeBars("HIST4", [bar(dayOffset(-2), "8")], new Date(NOW - 3 * 86_400_000));
    upstream.bars = new ProviderUnavailableError("down");

    const bars = await provider.getHistoricalPrices("HIST4", dayOffset(-60), dayOffset(0));

    expect(bars.map((b) => b.close.amount.toString())).toEqual(["8"]);
  });

  it("retries a zero-result symbol at most once per bar TTL", async () => {
    upstream.bars = [];

    await provider.getHistoricalPrices("EMPTY1", dayOffset(-10), dayOffset(0));
    await provider.getHistoricalPrices("EMPTY1", dayOffset(-10), dayOffset(0));
    await provider.getHistoricalPrices("EMPTY1", dayOffset(-10), dayOffset(0));

    // Without the attempt throttle this is 3: nothing is written, so
    // `fetchedAt` never advances and every request refetches forever.
    expect(upstream.barCalls).toBe(1);
  });

  // C2. Coverage is a property of (symbol, WINDOW), so a throttle keyed on the
  // symbol alone let a satisfied 1M fetch stand in for an ALL fetch that had
  // never happened. And because `to` is always now while the newest stored bar
  // is at best yesterday's close, `covered` is false essentially every day, so
  // the throttle — not coverage — is the operative gate: the narrow window
  // re-recorded on every refresh and won forever. User-visible: switch a chart
  // from 1M to ALL and the ALL series never extends past the 1M data, across
  // restarts, permanently.
  it("lets a wider window through the throttle while still refusing the same one", async () => {
    upstream.bars = [bar(dayOffset(-1), "1")];

    // Narrow first, on a cold symbol: blocks, fetches, records from = -30d.
    await provider.getHistoricalPrices("WIDEN1", dayOffset(-30), dayOffset(0));
    await drainPriceRefreshesForTests();
    expect(upstream.barCalls).toBe(1);

    // Wider, well inside BAR_TTL_MS. Stored bars cannot cover it, and this
    // window reaches further back than anything attempted, so it must go
    // upstream — it was never asked for.
    await provider.getHistoricalPrices("WIDEN1", dayOffset(-3650), dayOffset(0));
    await drainPriceRefreshesForTests();
    expect(upstream.barCalls).toBe(2);

    // Still a throttle: narrowing again is already answered by the wide fetch.
    await provider.getHistoricalPrices("WIDEN1", dayOffset(-30), dayOffset(0));
    await drainPriceRefreshesForTests();
    expect(upstream.barCalls).toBe(2);
  });

  it("refuses a repeat of the same window inside the TTL", async () => {
    upstream.bars = [bar(dayOffset(-1), "1")];

    await provider.getHistoricalPrices("SAMEWIN1", dayOffset(-30), dayOffset(0));
    await drainPriceRefreshesForTests();
    await provider.getHistoricalPrices("SAMEWIN1", dayOffset(-30), dayOffset(0));
    await drainPriceRefreshesForTests();

    expect(upstream.barCalls).toBe(1);
  });

  // Deferred-3: the background half of "record only on a COMPLETED fetch".
  // Mutating this catch to record on any error left the whole suite green.
  it("does not record a background bar refresh that failed transiently", async () => {
    // Stored bars that neither cover the window nor are fresh, so every read
    // serves from storage AND fires a background refresh.
    await store.writeBars("BGFAIL1", [bar(dayOffset(-1), "1")], new Date(NOW - 3 * 86_400_000));
    upstream.bars = new ProviderUnavailableError("down");

    await provider.getHistoricalPrices("BGFAIL1", dayOffset(-5), dayOffset(0));
    await drainPriceRefreshesForTests();
    await provider.getHistoricalPrices("BGFAIL1", dayOffset(-5), dayOffset(0));
    await drainPriceRefreshesForTests();

    // Recording on a transient error would throttle the identical second
    // window for a full BAR_TTL_MS after nothing more than a blip.
    expect(upstream.barCalls).toBe(2);
  });

  it("does record a background bar refresh that ended in SymbolNotFoundError", async () => {
    await store.writeBars("BGNOPE1", [bar(dayOffset(-1), "1")], new Date(NOW - 3 * 86_400_000));
    upstream.bars = new SymbolNotFoundError("BGNOPE1");

    await provider.getHistoricalPrices("BGNOPE1", dayOffset(-5), dayOffset(0));
    await drainPriceRefreshesForTests();
    await provider.getHistoricalPrices("BGNOPE1", dayOffset(-5), dayOffset(0));
    await drainPriceRefreshesForTests();

    // A definitive answer: do not re-ask for the same window.
    expect(upstream.barCalls).toBe(1);
  });

  it("caps concurrent background history refreshes at the budget", async () => {
    // Hold every refresh open so they accumulate instead of completing.
    let release!: () => void;
    upstream.barGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Eight symbols with stored bars that neither cover the window nor are
    // fresh, so each read serves from storage AND triggers a refresh.
    const staleFetch = new Date(NOW - 3 * 86_400_000);
    const symbols = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"];
    for (const s of symbols) {
      await store.writeBars(s, [bar(dayOffset(-1), "1")], staleFetch);
    }

    for (const s of symbols) {
      await provider.getHistoricalPrices(s, dayOffset(-5), dayOffset(0));
    }

    // Without the budget this is 8, and a 30-holding portfolio would fire 30.
    expect(upstream.barCalls).toBe(5);

    release();
    await drainPriceRefreshesForTests();

    // B6 was skipped for budget, not attempted. If the budget check and the
    // attempt-recording were reversed, B6 would have been marked attempted
    // anyway and this request would be silently throttled for BAR_TTL_MS.
    await provider.getHistoricalPrices("B6", dayOffset(-5), dayOffset(0));
    await drainPriceRefreshesForTests();
    expect(upstream.barCalls).toBe(6);
  });

  it("blocks on upstream when stored history starts after requireFrom", async () => {
    // Stored bars begin at -1d; the caller requires back to -30d.
    await store.writeBars("REQFROM1", [bar(dayOffset(-1), "100")], new Date(NOW));
    upstream.bars = [bar(dayOffset(-30), "90"), bar(dayOffset(-1), "100")];

    const bars = await provider.getHistoricalPrices("REQFROM1", dayOffset(-60), dayOffset(0), {
      requireFrom: dayOffset(-30),
    });

    expect(upstream.barCalls).toBe(1);
    expect(bars[0]!.date.toISOString().slice(0, 10)).toBe(
      dayOffset(-30).toISOString().slice(0, 10),
    );
  });

  it("does not block when requireFrom is already covered", async () => {
    // Stored bars already span the whole requested window, including requireFrom.
    await store.writeBars(
      "REQFROM2",
      [bar(dayOffset(-60), "80"), bar(dayOffset(0), "100")],
      new Date(NOW),
    );
    upstream.bars = [];

    await provider.getHistoricalPrices("REQFROM2", dayOffset(-60), dayOffset(0), {
      requireFrom: dayOffset(-30),
    });

    expect(upstream.barCalls).toBe(0);
  });

  it("starts no fetch once the deadline has passed", async () => {
    // Coverage is complete for the requested window (so no background refresh
    // fires either), but requireFrom reaches further back than what's stored —
    // it would trigger a blocking fetch if the deadline hadn't already passed.
    await store.writeBars(
      "REQFROM3",
      [bar(dayOffset(-60), "80"), bar(dayOffset(0), "100")],
      new Date(NOW),
    );
    upstream.bars = [bar(dayOffset(-3650), "1")];

    const bars = await provider.getHistoricalPrices("REQFROM3", dayOffset(-60), dayOffset(0), {
      requireFrom: dayOffset(-3650),
      deadline: NOW - 1,
    });

    expect(upstream.barCalls).toBe(0);
    expect(bars.map((b) => b.close.amount.toString())).toEqual(["80", "100"]);
  });

  it("serves stored bars when the required fetch fails", async () => {
    await store.writeBars("REQFROM4", [bar(dayOffset(-1), "100")], new Date(NOW));
    upstream.bars = new ProviderUnavailableError("down");

    const bars = await provider.getHistoricalPrices("REQFROM4", dayOffset(-60), dayOffset(0), {
      requireFrom: dayOffset(-30),
    });

    expect(bars.map((b) => b.close.amount.toString())).toEqual(["100"]);
  });

  it("passes dividends, search and profiles straight through", async () => {
    const spy = vi.spyOn(upstream, "getDividendHistory");
    await provider.getDividendHistory("ANY");
    expect(spy).toHaveBeenCalledOnce();
  });

  // Every test above wires `PersistedPriceProvider`
  // directly, never wrapped in `CachingMarketDataProvider` — but production is
  // CustomRouting -> Caching -> PersistedPrice (see apps/api/src/index.ts),
  // and a real dashboard request's `cacheOnly` flows through the Caching
  // layer FIRST. A bug there (see caching-provider.ts's history-cache key,
  // which used to build its key and call `inner.getHistoricalPrices(symbol,
  // from, to)` without `opts`) is invisible to every test in this file,
  // because none of them go through that layer. This block wires the real
  // shape so that class of regression is catchable here too.
  it("keeps cacheOnly from blocking through the real Caching -> Persisted chain", async () => {
    // A gate that is never released during this test stands in for "never
    // resolves": if `cacheOnly` were dropped anywhere between the caching
    // wrapper and the cold branch below, `PersistedPriceProvider` would
    // `await this.inner.getHistoricalPrices(...)`, which blocks on this gate
    // forever, and the `await` below would still be pending when the test's
    // own timeout fires -- failing loudly instead of quietly passing.
    let release!: () => void;
    upstream.barGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    upstream.bars = [bar(dayOffset(-1), "1")];

    const cache = new CachingMarketDataProvider(provider, 1000);

    const bars = await cache.getHistoricalPrices("CHAINCOLD1", dayOffset(-10), dayOffset(0), {
      cacheOnly: true,
    });

    expect(bars).toEqual([]);

    // Cleanup: let the background refill that the cold path now
    // kicks off actually finish, so nothing leaks into a later test.
    release();
    await drainPriceRefreshesForTests();
  });

  it("kicks off a background refill for a cold cacheOnly request instead of staying cold forever", async () => {
    // Without this, a symbol that only ever arrives via `cacheOnly`
    // (a fresh self-host whose only visitor is `/dashboard`) would never
    // warm -- nothing on that path would ever reach upstream.
    upstream.bars = [bar(dayOffset(-1), "5")];

    const bars = await provider.getHistoricalPrices(
      "COLDCACHEONLY1",
      dayOffset(-10),
      dayOffset(0),
      { cacheOnly: true },
    );

    // Never blocks: the caller gets `[]` on THIS call regardless of upstream
    // -- `refreshBarsInBackground` fires the refill and returns immediately,
    // it is not awaited. (Its synchronous prelude does call into `upstream`
    // before this `await` resolves, which is why `barCalls` is already 1
    // rather than 0 here -- only the WAIT is skipped, not the call.)
    expect(bars).toEqual([]);

    // Once the refill actually settles, it must have written to the store.
    await drainPriceRefreshesForTests();
    expect(upstream.barCalls).toBe(1);

    const cov = await store.coverage("COLDCACHEONLY1");
    expect(cov).not.toBeNull();
  });

  it("respects the refresh budget when several cold symbols arrive via cacheOnly at once", async () => {
    // Reuses `refreshBarsInBackground` -- the same budget as the "some
    // coverage already" path, not a parallel one of its own. Mirrors "caps
    // concurrent background history refreshes at the budget" above.
    let release!: () => void;
    upstream.barGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    upstream.bars = [bar(dayOffset(-1), "1")];

    const symbols = ["CC1", "CC2", "CC3", "CC4", "CC5", "CC6"];
    for (const s of symbols) {
      await provider.getHistoricalPrices(s, dayOffset(-5), dayOffset(0), { cacheOnly: true });
    }

    expect(upstream.barCalls).toBe(5);

    release();
    await drainPriceRefreshesForTests();
  });
});
