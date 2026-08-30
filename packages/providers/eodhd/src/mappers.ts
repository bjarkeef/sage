import { Money, Decimal, moneyFromMinorUnit } from "@sage/core";
import type { CurrencyCode } from "@sage/core";
import type {
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import type {
  EodBar,
  RealTimeQuote,
  DividendItem,
  SearchResult as EodhdSearchResult,
  FundamentalsResponse,
} from "./schemas";
import { eodhdToAppSymbol } from "./exchange-map";

function money(amount: number, currency: CurrencyCode): Money {
  return moneyFromMinorUnit(new Decimal(amount), currency);
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function mapQuote(raw: RealTimeQuote, currency: CurrencyCode): Quote {
  return {
    symbol: raw.code,
    price: money(raw.close, currency),
    asOf: new Date(raw.timestamp * 1000),
    previousClose: raw.previousClose != null ? money(raw.previousClose, currency) : null,
  };
}

export function mapPriceBar(bar: EodBar, currency: CurrencyCode): PriceBar {
  return {
    date: parseDate(bar.date),
    open: money(bar.open, currency),
    high: money(bar.high, currency),
    low: money(bar.low, currency),
    close: money(bar.close, currency),
    volume: new Decimal(bar.volume),
  };
}

export function mapDividend(item: DividendItem, symbol: string, currency: CurrencyCode): Dividend {
  return {
    symbol,
    amountPerShare: money(item.value, currency),
    exDividendDate: parseDate(item.date),
    paymentDate: item.paymentDate ? parseDate(item.paymentDate) : null,
    announcedDate: item.declarationDate ? parseDate(item.declarationDate) : null,
    recordDate: item.recordDate ? parseDate(item.recordDate) : null,
    period: item.period ?? null,
  };
}

function mapAssetType(type: string): "stock" | "etf" | "fund" | "index" | "other" {
  const lower = type.toLowerCase();
  if (lower.includes("etf")) return "etf";
  if (lower.includes("fund") || lower.includes("mutual")) return "fund";
  if (lower.includes("index")) return "index";
  if (lower.includes("stock") || lower.includes("common")) return "stock";
  return "other";
}

export function mapSearchResult(item: EodhdSearchResult): SearchResult {
  return {
    symbol: eodhdToAppSymbol(item.Code, item.Exchange),
    name: item.Name,
    exchange: item.Exchange,
    currency: item.Currency,
    assetType: mapAssetType(item.Type),
  };
}

export function mapAssetProfile(data: FundamentalsResponse): AssetProfile {
  const g = data.General;
  const h = data.Highlights;
  const t = data.Technicals;
  const sd = data.SplitsDividends;
  const currency = g.CurrencyCode;

  const fiftyTwoWeekHigh = t?.["52WeekHigh"] != null ? money(t["52WeekHigh"], currency) : null;
  const fiftyTwoWeekLow = t?.["52WeekLow"] != null ? money(t["52WeekLow"], currency) : null;
  const trailingAnnualDividend =
    sd?.TrailingAnnualDividendRate != null ? money(sd.TrailingAnnualDividendRate, currency) : null;

  let ceo: string | null = null;
  if (g.Officers) {
    const entry = Object.values(g.Officers).find(
      (o) =>
        o.Title?.toLowerCase().includes("ceo") ||
        o.Title?.toLowerCase().includes("chief executive"),
    );
    ceo = entry?.Name ?? null;
  }

  return {
    symbol: g.Code,
    name: g.Name,
    exchange: g.Exchange,
    currency,
    assetType: mapAssetType(g.Type ?? "stock"),
    sector: g.Sector ?? null,
    industry: g.Industry ?? null,
    marketCap: h?.MarketCapitalization != null ? new Decimal(h.MarketCapitalization) : null,
    peRatio: h?.PERatio != null ? new Decimal(h.PERatio) : null,
    beta: t?.Beta != null ? new Decimal(t.Beta) : null,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    dividendYield: h?.DividendYield != null ? new Decimal(h.DividendYield / 100) : null,
    payoutRatio: null,
    trailingAnnualDividend,
    website: g.WebURL ?? null,
    description: g.Description ?? null,
    ceo,
    fullTimeEmployees: g.FullTimeEmployees != null ? String(g.FullTimeEmployees) : null,
    ipoDate: g.IPODate ?? null,
    country: g.CountryName ?? null,
    countryIso: g.CountryISO ?? null,
    fund: null,
  };
}
