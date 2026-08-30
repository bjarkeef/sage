import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";

/**
 * Tries an ordered list of providers so a symbol the primary can't serve
 * (missing from its universe, or its quota is exhausted) is covered by a
 * later one (e.g. Yahoo). For the
 * single-value lookups (`getQuote`, `getAssetProfile`) it returns the first
 * provider that doesn't throw; for the list lookups it returns the first
 * non-empty result. Only falls through on failure, so a primary that succeeds is
 * never second-guessed and no extra upstream calls are made.
 */
export class FallbackMarketDataProvider implements IMarketDataProvider {
  private readonly providers: IMarketDataProvider[];

  constructor(providers: IMarketDataProvider[]) {
    if (providers.length === 0) {
      throw new Error("FallbackMarketDataProvider requires at least one provider");
    }
    this.providers = providers;
  }

  getQuote(symbol: string): Promise<Quote> {
    return this.firstSuccess((p) => p.getQuote(symbol));
  }

  getAssetProfile(symbol: string): Promise<AssetProfile> {
    return this.firstSuccess((p) => p.getAssetProfile(symbol));
  }

  getHistoricalPrices(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
    return this.firstNonEmpty((p) => p.getHistoricalPrices(symbol, from, to));
  }

  searchSymbol(query: string): Promise<SearchResult[]> {
    return this.firstNonEmpty((p) => p.searchSymbol(query));
  }

  getDividendHistory(symbol: string): Promise<Dividend[]> {
    return this.firstNonEmpty((p) => p.getDividendHistory(symbol));
  }

  /** First result that doesn't throw; rethrow the last error if every one fails. */
  private async firstSuccess<T>(call: (p: IMarketDataProvider) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await call(provider);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  /**
   * First non-empty array. An empty array is a valid "no data" answer, so if a
   * provider returns one we keep looking but still resolve to `[]` at the end
   * rather than throwing — unless every provider threw, in which case rethrow.
   */
  private async firstNonEmpty<T>(call: (p: IMarketDataProvider) => Promise<T[]>): Promise<T[]> {
    let lastError: unknown;
    let sawResult = false;
    for (const provider of this.providers) {
      try {
        const result = await call(provider);
        sawResult = true;
        if (result.length > 0) return result;
      } catch (err) {
        lastError = err;
      }
    }
    if (sawResult) return [];
    throw lastError;
  }
}
