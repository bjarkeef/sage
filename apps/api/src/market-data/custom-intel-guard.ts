import {
  SymbolNotFoundError,
  type AnalystRatings,
  type IAnalystRatingsProvider,
  type INewsProvider,
  type NewsArticle,
} from "@sage/provider-interface";

/**
 * Sits in front of the news/ratings provider, which is a direct Yahoo handle
 * outside the price chain and so never passed through CustomRoutingProvider.
 *
 * A custom holding is the user's own instrument (a savings account, a
 * pension). Its symbol is never sent upstream: that would disclose a private
 * holding to a third party, and there is nothing to find anyway. A market
 * symbol the provider does not carry reads as no coverage, like a symbol
 * with no analysts, instead of failing the request.
 */
export class CustomIntelGuard implements INewsProvider, IAnalystRatingsProvider {
  constructor(
    private readonly isCustom: (symbol: string) => Promise<boolean>,
    private readonly upstream: INewsProvider & IAnalystRatingsProvider,
  ) {}

  async getNews(symbol: string): Promise<NewsArticle[]> {
    if (await this.isCustom(symbol)) return [];
    return notFoundAs(this.upstream.getNews(symbol), []);
  }

  async getAnalystRatings(symbol: string): Promise<AnalystRatings | null> {
    if (await this.isCustom(symbol)) return null;
    return notFoundAs(this.upstream.getAnalystRatings(symbol), null);
  }
}

async function notFoundAs<T>(call: Promise<T>, empty: T): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (err instanceof SymbolNotFoundError) return empty;
    throw err;
  }
}
