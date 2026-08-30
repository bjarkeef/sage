import type { NewsArticle, AnalystRatings } from "./types";

/** Optional capability: a provider that can return recent news for a symbol. */
export interface INewsProvider {
  getNews(symbol: string): Promise<NewsArticle[]>;
}

/** Optional capability: a provider that can return analyst ratings for a symbol. */
export interface IAnalystRatingsProvider {
  getAnalystRatings(symbol: string): Promise<AnalystRatings | null>;
}
