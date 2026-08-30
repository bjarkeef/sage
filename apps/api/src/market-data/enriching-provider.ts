import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";

/**
 * Wraps a primary provider and fills null fundamental fields on
 * `getAssetProfile` from a secondary enrichment provider. All other
 * methods delegate to the primary. If the enrichment call fails,
 * the primary's result is returned as-is — enrichment is best-effort.
 */
export class EnrichingProvider implements IMarketDataProvider {
  constructor(
    private readonly primary: IMarketDataProvider,
    private readonly enrichment: IMarketDataProvider,
  ) {}

  getQuote(symbol: string): Promise<Quote> {
    return this.primary.getQuote(symbol);
  }

  getHistoricalPrices(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
    return this.primary.getHistoricalPrices(symbol, from, to);
  }

  getDividendHistory(symbol: string): Promise<Dividend[]> {
    return this.primary.getDividendHistory(symbol);
  }

  searchSymbol(query: string): Promise<SearchResult[]> {
    return this.primary.searchSymbol(query);
  }

  async getAssetProfile(symbol: string): Promise<AssetProfile> {
    const profile = await this.primary.getAssetProfile(symbol);

    const needsEnrichment =
      profile.marketCap === null || profile.peRatio === null || profile.beta === null;

    if (!needsEnrichment) return profile;

    try {
      const enriched = await this.enrichment.getAssetProfile(symbol);
      return {
        ...profile,
        marketCap: profile.marketCap ?? enriched.marketCap,
        peRatio: profile.peRatio ?? enriched.peRatio,
        beta: profile.beta ?? enriched.beta,
        fiftyTwoWeekHigh: profile.fiftyTwoWeekHigh ?? enriched.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: profile.fiftyTwoWeekLow ?? enriched.fiftyTwoWeekLow,
        dividendYield: profile.dividendYield ?? enriched.dividendYield,
        payoutRatio: profile.payoutRatio ?? enriched.payoutRatio,
        trailingAnnualDividend: profile.trailingAnnualDividend ?? enriched.trailingAnnualDividend,
        sector: profile.sector ?? enriched.sector,
        industry: profile.industry ?? enriched.industry,
      };
    } catch {
      return profile;
    }
  }
}
