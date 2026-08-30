import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import type { ProviderHealthRegistry } from "./provider-health";

/**
 * Reports each call's outcome to a {@link ProviderHealthRegistry} and is
 * otherwise invisible.
 *
 * Wrapped around LEAF adapters at the composition root, never around the
 * composites: only the composition root knows a provider's name, and only the
 * leaf represents a single upstream. Several wrappers may share a name (Yahoo
 * appears in the main chain, the enricher and the dividend chain) — they all
 * report to the same entry, which is what you want, because the question is
 * whether the upstream is reachable, not which caller reached it.
 *
 * It sits INSIDE CachingMarketDataProvider, so a cache hit records nothing.
 * That is correct — a cache hit is no evidence the provider is up — but it
 * means `lastSuccessAt` can lag by up to the quote TTL, which the UI copy says.
 */
export class HealthTrackingProvider implements IMarketDataProvider {
  constructor(
    private readonly name: string,
    private readonly inner: IMarketDataProvider,
    private readonly registry: ProviderHealthRegistry,
  ) {
    // Seed the entry so a configured provider that has not been called yet
    // still appears on the card as "unknown" rather than being absent.
    registry.register(name);
  }

  getQuote(symbol: string): Promise<Quote> {
    return this.track(() => this.inner.getQuote(symbol));
  }

  getHistoricalPrices(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
    return this.track(() => this.inner.getHistoricalPrices(symbol, from, to));
  }

  getDividendHistory(symbol: string): Promise<Dividend[]> {
    return this.track(() => this.inner.getDividendHistory(symbol));
  }

  searchSymbol(query: string): Promise<SearchResult[]> {
    return this.track(() => this.inner.searchSymbol(query));
  }

  getAssetProfile(symbol: string): Promise<AssetProfile> {
    return this.track(() => this.inner.getAssetProfile(symbol));
  }

  /**
   * Records the outcome and rethrows the ORIGINAL error.
   *
   * Not a copy and not a wrapper: FallbackMarketDataProvider's retry and every
   * SymbolNotFoundError branch downstream test with `instanceof`, so replacing
   * the error here would silently break the fallback chain this exists to
   * protect.
   */
  private async track<T>(call: () => Promise<T>): Promise<T> {
    try {
      const result = await call();
      this.registry.recordSuccess(this.name);
      return result;
    } catch (error) {
      this.registry.recordFailure(this.name, error);
      throw error;
    }
  }
}
