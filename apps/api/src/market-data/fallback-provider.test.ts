import { describe, it, expect, vi } from "vitest";
import { Money } from "@sage/core";
import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import { SymbolNotFoundError } from "@sage/provider-interface";
import { FallbackMarketDataProvider } from "./fallback-provider";

function makeQuote(symbol: string, price: string): Quote {
  return {
    symbol,
    price: Money.of(price, "USD"),
    asOf: new Date("2026-06-30"),
    previousClose: null,
  };
}

function makeBar(): PriceBar {
  return {
    date: new Date("2026-06-30"),
    open: Money.of("1", "USD"),
    high: Money.of("2", "USD"),
    low: Money.of("1", "USD"),
    close: Money.of("1.5", "USD"),
    volume: Money.of("0", "USD").amount, // a Decimal
  };
}

function makeProfile(symbol: string): AssetProfile {
  return {
    symbol,
    name: symbol,
    exchange: "XNAS",
    currency: "USD",
    assetType: "etf",
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

/** Build a provider whose methods default to "no data" (throw for quote/profile,
 *  [] for the list methods) unless overridden. */
function provider(overrides: Partial<IMarketDataProvider> = {}): IMarketDataProvider {
  return {
    getQuote: (s: string) => Promise.reject(new SymbolNotFoundError(s)),
    getHistoricalPrices: () => Promise.resolve<PriceBar[]>([]),
    getDividendHistory: () => Promise.resolve<Dividend[]>([]),
    searchSymbol: () => Promise.resolve<SearchResult[]>([]),
    getAssetProfile: (s: string) => Promise.reject(new SymbolNotFoundError(s)),
    ...overrides,
  };
}

describe("FallbackMarketDataProvider", () => {
  it("returns the primary's quote without consulting the fallback when it succeeds", async () => {
    const fallbackQuote = vi.fn(() => Promise.resolve(makeQuote("AAPL", "200")));
    const fb = new FallbackMarketDataProvider([
      provider({ getQuote: () => Promise.resolve(makeQuote("AAPL", "150")) }),
      provider({ getQuote: fallbackQuote }),
    ]);
    const q = await fb.getQuote("AAPL");
    expect(q.price.toString()).toBe("150");
    expect(fallbackQuote).not.toHaveBeenCalled();
  });

  it("falls back to the next provider when the primary cannot price the symbol", async () => {
    const fb = new FallbackMarketDataProvider([
      provider(), // throws SymbolNotFound
      provider({ getQuote: () => Promise.resolve(makeQuote("EUDIV.DE", "51.92")) }),
    ]);
    const q = await fb.getQuote("EUDIV.DE");
    expect(q.price.toString()).toBe("51.92");
  });

  it("throws the last error when no provider can price the symbol", async () => {
    const fb = new FallbackMarketDataProvider([provider(), provider()]);
    await expect(fb.getQuote("NOPE")).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it("returns the first non-empty history, skipping a provider that has none", async () => {
    const bars = [makeBar()];
    const fb = new FallbackMarketDataProvider([
      provider(), // returns []
      provider({ getHistoricalPrices: () => Promise.resolve(bars) }),
    ]);
    const result = await fb.getHistoricalPrices("EUDIV.DE", new Date("2026-01-01"), new Date());
    expect(result).toHaveLength(1);
  });

  it("returns [] for history when every provider is empty (no throw)", async () => {
    const fb = new FallbackMarketDataProvider([provider(), provider()]);
    expect(await fb.getHistoricalPrices("X", new Date("2026-01-01"), new Date())).toEqual([]);
  });

  it("falls back for getAssetProfile when the primary throws", async () => {
    const fb = new FallbackMarketDataProvider([
      provider(),
      provider({ getAssetProfile: (s) => Promise.resolve(makeProfile(s)) }),
    ]);
    const p = await fb.getAssetProfile("EUDIV.DE");
    expect(p.symbol).toBe("EUDIV.DE");
    expect(p.assetType).toBe("etf");
  });
});
