import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import { SymbolNotFoundError } from "@sage/provider-interface";
import { EodhdClient } from "./client";
import type { EodhdClientConfig } from "./client";
import {
  eodResponseSchema,
  realTimeSchema,
  dividendResponseSchema,
  searchResponseSchema,
  fundamentalsResponseSchema,
  parse,
} from "./schemas";
import { mapQuote, mapPriceBar, mapDividend, mapSearchResult, mapAssetProfile } from "./mappers";
import { appSymbolToEodhd } from "./exchange-map";

export interface EodhdProviderConfig extends EodhdClientConfig {
  defaultExchange?: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class EodhdProvider implements IMarketDataProvider {
  private readonly client: EodhdClient;
  private readonly defaultExchange: string;

  constructor(config: EodhdProviderConfig) {
    this.client = new EodhdClient(config);
    this.defaultExchange = config.defaultExchange ?? "US";
  }

  private symbolPath(symbol: string): string {
    return appSymbolToEodhd(symbol, this.defaultExchange);
  }

  async getQuote(symbol: string): Promise<Quote> {
    const sym = this.symbolPath(symbol);
    const raw = await this.client.request(`/real-time/${sym}`, { notFoundSymbol: symbol });
    const parsed = parse(realTimeSchema, raw);
    if (parsed.close === 0 && parsed.volume === 0) {
      throw new SymbolNotFoundError(symbol);
    }
    return mapQuote(parsed, await this.resolveCurrency(sym));
  }

  async getHistoricalPrices(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
    const sym = this.symbolPath(symbol);
    const raw = await this.client.request(`/eod/${sym}`, {
      params: {
        from: isoDate(from),
        to: isoDate(to),
        order: "a",
      },
      notFoundSymbol: symbol,
    });
    const bars = parse(eodResponseSchema, raw);
    if (bars.length === 0) return [];
    const currency = await this.resolveCurrency(sym);
    return bars.map((b) => mapPriceBar(b, currency));
  }

  async getDividendHistory(symbol: string): Promise<Dividend[]> {
    const sym = this.symbolPath(symbol);
    const raw = await this.client.request(`/div/${sym}`, { notFoundSymbol: symbol });
    const items = parse(dividendResponseSchema, raw);
    if (items.length === 0) return [];

    // EODHD's /div rows carry their own currency and are available on the free
    // tier; the fundamentals endpoint (resolveCurrency) is paywalled, so only
    // reach for it when a row omits currency — and never let that call fail the
    // whole fetch (a 403 there must not lose otherwise-good dividend data).
    let fallbackCurrency: string | null = null;
    if (items.some((item) => !item.currency)) {
      try {
        fallbackCurrency = await this.resolveCurrency(sym);
      } catch {
        fallbackCurrency = null;
      }
    }

    const dividends: Dividend[] = [];
    for (const item of items) {
      const currency = item.currency ?? fallbackCurrency;
      if (currency) dividends.push(mapDividend(item, symbol, currency));
    }
    return dividends;
  }

  async searchSymbol(query: string): Promise<SearchResult[]> {
    const raw = await this.client.request(`/search/${encodeURIComponent(query)}`);
    const items = parse(searchResponseSchema, raw);
    return items.map(mapSearchResult);
  }

  async getAssetProfile(symbol: string): Promise<AssetProfile> {
    const sym = this.symbolPath(symbol);
    const raw = await this.client.request(`/v1.1/fundamentals/${sym}`, { notFoundSymbol: symbol });
    const data = parse(fundamentalsResponseSchema, raw);
    return mapAssetProfile(data);
  }

  private currencyCache = new Map<string, string>();

  private async resolveCurrency(eodhdSymbol: string): Promise<string> {
    const cached = this.currencyCache.get(eodhdSymbol);
    if (cached) return cached;
    const raw = await this.client.request(`/v1.1/fundamentals/${eodhdSymbol}`, {
      params: { filter: "General::CurrencyCode" },
      notFoundSymbol: eodhdSymbol,
    });
    const currency = typeof raw === "string" ? raw.replace(/"/g, "") : "USD";
    this.currencyCache.set(eodhdSymbol, currency);
    return currency;
  }
}
