import type { IMarketDataProvider } from "../market-data-provider";
import type { Quote, PriceBar, Dividend, SearchResult, AssetProfile } from "../types";
import { SymbolNotFoundError } from "../errors";

/** Canned data for a {@link FakeMarketDataProvider}. */
export interface FakeMarketDataConfig {
  quotes?: Record<string, Quote>;
  history?: Record<string, PriceBar[]>;
  dividends?: Record<string, Dividend[]>;
  search?: Record<string, SearchResult[]>; // keyed by exact query string
  profiles?: Record<string, AssetProfile>;
}

/**
 * A network-free {@link IMarketDataProvider} returning configured canned data.
 * Useful as a test double; its existence proves the contract is implementable.
 */
export class FakeMarketDataProvider implements IMarketDataProvider {
  constructor(private readonly config: FakeMarketDataConfig = {}) {}

  getQuote(symbol: string): Promise<Quote> {
    const quote = this.config.quotes?.[symbol];
    if (!quote) {
      return Promise.reject(new SymbolNotFoundError(symbol));
    }
    return Promise.resolve(quote);
  }

  getHistoricalPrices(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
    const bars = this.config.history?.[symbol] ?? [];
    return Promise.resolve(bars.filter((bar) => bar.date >= from && bar.date <= to));
  }

  getDividendHistory(symbol: string): Promise<Dividend[]> {
    return Promise.resolve(this.config.dividends?.[symbol] ?? []);
  }

  searchSymbol(query: string): Promise<SearchResult[]> {
    return Promise.resolve(this.config.search?.[query] ?? []);
  }

  getAssetProfile(symbol: string): Promise<AssetProfile> {
    const profile = this.config.profiles?.[symbol];
    if (!profile) {
      return Promise.reject(new SymbolNotFoundError(symbol));
    }
    return Promise.resolve(profile);
  }
}
