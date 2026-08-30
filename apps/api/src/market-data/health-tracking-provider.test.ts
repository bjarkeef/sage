import { describe, it, expect, afterEach, vi } from "vitest";
import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import { ProviderUnavailableError, SymbolNotFoundError } from "@sage/provider-interface";
import { Money } from "@sage/core";
import { EodhdProvider } from "@sage/provider-eodhd";
import { HealthTrackingProvider } from "./health-tracking-provider";
import { ProviderHealthRegistry } from "./provider-health";

function quote(symbol: string): Quote {
  return { symbol, price: Money.of("100", "USD"), asOf: new Date(), previousClose: null };
}

function assetProfile(symbol: string): AssetProfile {
  return {
    symbol,
    name: "Test Co",
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
  };
}

/** A provider whose every method resolves — including `getAssetProfile`, so a
 *  test that calls all five methods actually exercises every success path. */
class OkProvider implements IMarketDataProvider {
  getQuote(symbol: string): Promise<Quote> {
    return Promise.resolve(quote(symbol));
  }
  getHistoricalPrices(): Promise<PriceBar[]> {
    return Promise.resolve([]);
  }
  getDividendHistory(): Promise<Dividend[]> {
    return Promise.resolve([]);
  }
  searchSymbol(): Promise<SearchResult[]> {
    return Promise.resolve([]);
  }
  getAssetProfile(symbol: string): Promise<AssetProfile> {
    return Promise.resolve(assetProfile(symbol));
  }
}

/** A provider whose every method rejects with the given error. */
class FailingProvider implements IMarketDataProvider {
  constructor(private readonly error: Error) {}
  getQuote(): Promise<Quote> {
    return Promise.reject(this.error);
  }
  getHistoricalPrices(): Promise<PriceBar[]> {
    return Promise.reject(this.error);
  }
  getDividendHistory(): Promise<Dividend[]> {
    return Promise.reject(this.error);
  }
  searchSymbol(): Promise<SearchResult[]> {
    return Promise.reject(this.error);
  }
  getAssetProfile(): Promise<AssetProfile> {
    return Promise.reject(this.error);
  }
}

/** Drives the REAL EodhdProvider -> EodhdClient chain via a stubbed global
 *  `fetch`, so this exercises the actual 404 -> SymbolNotFoundError mapping
 *  added to client.ts, not a stand-in. */
function realisticEodhdProvider() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  return new EodhdProvider({ apiToken: "test-token", baseUrl: "https://eodhd.test/api" });
}

function wrap(inner: IMarketDataProvider, now?: () => number) {
  const registry = new ProviderHealthRegistry(now);
  const provider = new HealthTrackingProvider("yahoo", inner, registry);
  return { provider, registry, health: () => registry.snapshot()[0]! };
}

describe("HealthTrackingProvider", () => {
  it("registers its name on construction so it shows as unknown before use", () => {
    const { health } = wrap(new OkProvider());
    expect(health().name).toBe("yahoo");
    expect(health().state).toBe("unknown");
  });

  it("passes the inner value through unchanged", async () => {
    const { provider } = wrap(new OkProvider());
    await expect(provider.getQuote("AAPL")).resolves.toMatchObject({ symbol: "AAPL" });
  });

  it("records a success for each of the five interface methods, not just the first", async () => {
    // Asserting only `state === "healthy"` at the end is too weak a bar: it
    // passes even if only one of the five methods ever actually recorded
    // anything, as long as none of them recorded a failure. An injected clock
    // that ticks once per call makes each method's recording independently
    // observable: `lastSuccessAt` must advance by exactly one tick per call.
    let tick = 0;
    const { provider, health } = wrap(new OkProvider(), () => ++tick);

    await provider.getQuote("AAPL");
    expect(health().lastSuccessAt).toBe(1);

    await provider.getHistoricalPrices("AAPL", new Date(), new Date());
    expect(health().lastSuccessAt).toBe(2);

    await provider.getDividendHistory("AAPL");
    expect(health().lastSuccessAt).toBe(3);

    await provider.searchSymbol("apple");
    expect(health().lastSuccessAt).toBe(4);

    await provider.getAssetProfile("AAPL");
    expect(health().lastSuccessAt).toBe(5);

    expect(health().state).toBe("healthy");
  });

  it("rethrows the ORIGINAL error object, so instanceof still works downstream", async () => {
    const original = new ProviderUnavailableError("upstream is down");
    const { provider } = wrap(new FailingProvider(original));
    await expect(provider.getQuote("AAPL")).rejects.toBe(original);
  });

  it("records a failure with the classified reason", async () => {
    const { provider, health } = wrap(new FailingProvider(new ProviderUnavailableError()));
    await expect(provider.getQuote("AAPL")).rejects.toThrow();
    expect(health().state).toBe("degraded");
    expect(health().lastFailureReason).toBe("unavailable");
  });

  it("does not mark the provider degraded for a missing symbol", async () => {
    const { provider, health } = wrap(new FailingProvider(new SymbolNotFoundError("NOPE")));
    await expect(provider.getQuote("NOPE")).rejects.toBeInstanceOf(SymbolNotFoundError);
    expect(health().state).toBe("unknown");
  });

  it("records failures from every interface method", async () => {
    const { provider, health } = wrap(new FailingProvider(new ProviderUnavailableError()));
    await expect(provider.getHistoricalPrices("A", new Date(), new Date())).rejects.toThrow();
    await expect(provider.getDividendHistory("A")).rejects.toThrow();
    await expect(provider.searchSymbol("a")).rejects.toThrow();
    await expect(provider.getAssetProfile("A")).rejects.toThrow();
    expect(health().consecutiveFailures).toBe(4);
  });

  describe("with a realistic client, not a hand-rolled SymbolNotFoundError", () => {
    // Regression coverage for the actual bug: the decorator tests above inject
    // SymbolNotFoundError directly, which assumes the client layer already
    // classifies "unknown symbol" correctly. It didn't — EODHD's 404 was
    // falling through to ProviderUnavailableError before client.ts was fixed,
    // which would have marked the provider "degraded" here. (Yahoo's client
    // fix has the equivalent proof in
    // packages/providers/yahoo-finance/src/client.test.ts and provider.test.ts:
    // yahoo-finance2 owns its own crumb/cookie/fetch pipeline, so there is no
    // HTTP boundary to stub from outside that package the way EODHD's plain
    // `fetch` allows here.)
    afterEach(() => vi.unstubAllGlobals());

    it("does not mark EODHD degraded for a 404'd symbol from the real client", async () => {
      const registry = new ProviderHealthRegistry();
      const provider = new HealthTrackingProvider("eodhd", realisticEodhdProvider(), registry);
      await expect(provider.getQuote("NOPE")).rejects.toBeInstanceOf(SymbolNotFoundError);
      expect(registry.snapshot()[0]!.state).toBe("unknown");
    });
  });

  it("shares one entry between two wrappers of the same name", async () => {
    const registry = new ProviderHealthRegistry();
    const a = new HealthTrackingProvider("yahoo", new OkProvider(), registry);
    const b = new HealthTrackingProvider(
      "yahoo",
      new FailingProvider(new ProviderUnavailableError()),
      registry,
    );
    await a.getQuote("AAPL");
    await expect(b.getQuote("AAPL")).rejects.toThrow();
    expect(registry.snapshot()).toHaveLength(1);
    expect(registry.snapshot()[0]!.state).toBe("degraded");
  });
});
