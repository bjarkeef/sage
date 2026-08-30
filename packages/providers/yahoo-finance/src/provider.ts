import type {
  IMarketDataProvider,
  INewsProvider,
  IAnalystRatingsProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
  NewsArticle,
  AnalystRatings,
} from "@sage/provider-interface";
import { SymbolNotFoundError } from "@sage/provider-interface";
import { Decimal } from "@sage/core";
import { YahooFinanceClient } from "./client";
import type {
  YfChartResult,
  YfQuote,
  YfSearchResult,
  YfSummaryResult,
  YfSearchNews,
  YfRatingsResult,
} from "./client";
import {
  mapQuote,
  mapPriceBar,
  mapDividend,
  mapSearchResult,
  mapAssetProfile,
  applyAssetProfileModule,
  mapFundProfile,
  mapNewsArticle,
  mapAnalystRatings,
} from "./mappers";

const DIVIDEND_LOOKBACK = new Date("1970-01-01");

export interface YahooFinanceProviderClient {
  quote(symbol: string): Promise<YfQuote>;
  quoteSummary?(symbol: string): Promise<YfSummaryResult>;
  fundSummary?(symbol: string): Promise<YfSummaryResult>;
  chart(symbol: string, from: Date, to: Date): Promise<YfChartResult>;
  search(query: string): Promise<YfSearchResult>;
  news(symbol: string): Promise<YfSearchNews[]>;
  ratingsSummary(symbol: string): Promise<YfRatingsResult>;
}

export class YahooFinanceProvider
  implements IMarketDataProvider, INewsProvider, IAnalystRatingsProvider
{
  private readonly client: YahooFinanceProviderClient;

  constructor(client?: YahooFinanceProviderClient) {
    this.client = client ?? new YahooFinanceClient();
  }

  async getQuote(symbol: string): Promise<Quote> {
    const raw = await this.client.quote(symbol);
    const quote = mapQuote(raw);
    if (!quote) throw new SymbolNotFoundError(symbol);
    return quote;
  }

  async getHistoricalPrices(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
    const result = await this.client.chart(symbol, from, to);
    const currency = result.meta.currency;
    const bars: PriceBar[] = [];
    for (const q of result.quotes) {
      const bar = mapPriceBar(q, currency);
      if (bar) bars.push(bar);
    }
    bars.sort((a, b) => a.date.getTime() - b.date.getTime());
    return bars;
  }

  async getDividendHistory(symbol: string): Promise<Dividend[]> {
    const result = await this.client.chart(symbol, DIVIDEND_LOOKBACK, new Date());
    const currency = result.meta.currency;
    const events = result.events?.dividends ?? [];
    return events.map((e) => mapDividend(e, result.meta.symbol, currency));
  }

  async searchSymbol(query: string): Promise<SearchResult[]> {
    const raw = await this.client.search(query);
    const results: SearchResult[] = [];
    for (const item of raw.quotes) {
      if (!item.isYahooFinance) continue;
      const mapped = mapSearchResult(item);
      if (mapped) results.push(mapped);
    }
    return results;
  }

  async getAssetProfile(symbol: string): Promise<AssetProfile> {
    const raw = await this.client.quote(symbol);
    const profile = mapAssetProfile(raw);
    if (!profile) throw new SymbolNotFoundError(symbol);

    let result = profile;

    // quote() carries neither beta nor company-level descriptive fields
    // (website, description, country, CEO). Fetch both from quoteSummary's
    // defaultKeyStatistics + assetProfile modules in one call.
    if (this.client.quoteSummary) {
      try {
        const summary = await this.client.quoteSummary(symbol);
        const beta = summary.defaultKeyStatistics?.beta;
        if (result.beta === null && beta != null) {
          result = { ...result, beta: new Decimal(beta) };
        }
        const payoutRatio = summary.summaryDetail?.payoutRatio;
        if (payoutRatio != null) {
          result = { ...result, payoutRatio: new Decimal(payoutRatio) };
        }
        result = applyAssetProfileModule(result, summary.assetProfile);
      } catch {
        // quoteSummary failed — return profile without beta/company fields
      }
    }

    // For funds/ETFs, attach fund-specific fundamentals (expense ratio, AUM,
    // top holdings, sector weights) from the fund quoteSummary modules.
    if ((result.assetType === "etf" || result.assetType === "fund") && this.client.fundSummary) {
      try {
        result = { ...result, fund: mapFundProfile(await this.client.fundSummary(symbol)) };
      } catch {
        // fund modules unavailable — leave fund null
      }
    }

    return result;
  }

  async getNews(symbol: string): Promise<NewsArticle[]> {
    const raw = await this.client.news(symbol);
    return raw.map(mapNewsArticle);
  }

  async getAnalystRatings(symbol: string): Promise<AnalystRatings | null> {
    const raw = await this.client.ratingsSummary(symbol);
    return mapAnalystRatings(raw, new Date());
  }
}
