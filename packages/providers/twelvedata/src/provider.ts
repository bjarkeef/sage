import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import { TwelveDataClient } from "./client";
import type { TwelveDataClientConfig } from "./client";
import { appSymbolToTwelveData, listingKey, listingParams } from "./exchange-map";
import {
  parse,
  quoteSchema,
  timeSeriesSchema,
  dividendsSchema,
  profileSchema,
  searchSchema,
} from "./schemas";
import { mapQuote, mapPriceBars, mapDividends, mapAssetProfile, mapSearchResults } from "./mappers";

export type TwelveDataProviderConfig = TwelveDataClientConfig;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class TwelveDataProvider implements IMarketDataProvider {
  private readonly client: TwelveDataClient;

  constructor(config: TwelveDataProviderConfig) {
    this.client = new TwelveDataClient(config);
  }

  /** Throws SymbolNotFoundError for an unmapped suffix before any request. */
  private target(symbol: string) {
    const listing = appSymbolToTwelveData(symbol);
    return {
      params: listingParams(listing),
      options: { listingKey: listingKey(listing), notFoundSymbol: symbol },
    };
  }

  async getQuote(symbol: string): Promise<Quote> {
    const { params, options } = this.target(symbol);
    const raw = await this.client.request("quote", params, options);
    return mapQuote(parse(quoteSchema, raw), symbol);
  }

  async getHistoricalPrices(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
    const { params, options } = this.target(symbol);
    const raw = await this.client.request(
      "time_series",
      {
        ...params,
        interval: "1day",
        start_date: isoDate(from),
        end_date: isoDate(to),
        // Explicit, so a change to Twelve Data's default can never change the
        // series price_daily stores: split-adjusted, NOT dividend-adjusted.
        adjust: "splits",
      },
      { ...options, allowNoData: true },
    );
    if (raw === null) return [];
    return mapPriceBars(parse(timeSeriesSchema, raw));
  }

  async getDividendHistory(symbol: string): Promise<Dividend[]> {
    const { params, options } = this.target(symbol);
    const raw = await this.client.request("dividends", { ...params, range: "full" }, options);
    return mapDividends(parse(dividendsSchema, raw), symbol);
  }

  /** Sequential, not parallel: a refused profile must not spend a quote credit. */
  async getAssetProfile(symbol: string): Promise<AssetProfile> {
    const { params, options } = this.target(symbol);
    const profile = parse(profileSchema, await this.client.request("profile", params, options));
    const quote = parse(quoteSchema, await this.client.request("quote", params, options));
    return mapAssetProfile(profile, quote, symbol);
  }

  async searchSymbol(query: string): Promise<SearchResult[]> {
    const raw = await this.client.request("symbol_search", { symbol: query, outputsize: "30" });
    return mapSearchResults(parse(searchSchema, raw));
  }
}
