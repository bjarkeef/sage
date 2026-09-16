import { Money, Decimal, moneyFromMinorUnit, normalizeMinorUnit } from "@sage/core";
import { countryNameToIso } from "@sage/provider-interface";
import type {
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
  AssetType,
} from "@sage/provider-interface";
import type { TdQuote, TdTimeSeries, TdDividends, TdProfile, TdSearch } from "./schemas";
import { twelveDataToAppSymbol } from "./exchange-map";

/** London listings are quoted in pence (`GBp`); every amount leaves here in the
 *  major unit, or a holding reads 100x too large. */
function money(amount: string, currency: string): Money {
  return moneyFromMinorUnit(amount, currency);
}

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

/** An empty string is Twelve Data's way of saying "unknown". */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

export function mapAssetType(type: string | null | undefined): AssetType {
  switch (type) {
    case "Common Stock":
    case "REIT":
    case "Preferred Stock":
    case "American Depositary Receipt":
    case "Depositary Receipt":
      return "stock";
    case "ETF":
      return "etf";
    case "Mutual Fund":
    case "Closed-end Fund":
      return "fund";
    default:
      return "other";
  }
}

export function mapQuote(raw: TdQuote, appSymbol: string): Quote {
  return {
    symbol: appSymbol,
    price: money(raw.close, raw.currency),
    asOf: new Date((raw.last_quote_at ?? raw.timestamp) * 1000),
    previousClose: raw.previous_close ? money(raw.previous_close, raw.currency) : null,
  };
}

/** Twelve Data answers newest first; the price store expects oldest first. */
export function mapPriceBars(raw: TdTimeSeries): PriceBar[] {
  const currency = raw.meta.currency;
  return [...raw.values].reverse().map((v) => ({
    date: utcDate(v.datetime),
    open: money(v.open, currency),
    high: money(v.high, currency),
    low: money(v.low, currency),
    close: money(v.close, currency),
    volume: new Decimal(v.volume ?? "0"),
  }));
}

/** Twelve Data sends only the ex-date and amount. The payment date stays null
 *  and Sage's own estimate fills it, as it does for any provider that omits it. */
export function mapDividends(raw: TdDividends, appSymbol: string): Dividend[] {
  return raw.dividends.map((d) => ({
    symbol: appSymbol,
    amountPerShare: money(String(d.amount), raw.meta.currency),
    exDividendDate: utcDate(d.ex_date),
    paymentDate: null,
    announcedDate: null,
    recordDate: null,
    period: null,
  }));
}

/** `/profile` carries no currency, so the quote supplies it along with the
 *  52-week range. Valuation fields stay null: Yahoo enrichment fills them. */
export function mapAssetProfile(
  profile: TdProfile,
  quote: TdQuote,
  appSymbol: string,
): AssetProfile {
  const country = text(profile.country);
  const range = quote.fifty_two_week;
  return {
    symbol: appSymbol,
    name: profile.name,
    exchange: profile.exchange,
    currency: normalizeMinorUnit(quote.currency).currency,
    assetType: mapAssetType(profile.type),
    sector: text(profile.sector),
    industry: text(profile.industry),
    marketCap: null,
    peRatio: null,
    beta: null,
    fiftyTwoWeekHigh: range?.high ? money(range.high, quote.currency) : null,
    fiftyTwoWeekLow: range?.low ? money(range.low, quote.currency) : null,
    dividendYield: null,
    payoutRatio: null,
    trailingAnnualDividend: null,
    website: text(profile.website),
    description: text(profile.description),
    ceo: text(profile.CEO),
    fullTimeEmployees: profile.employees != null ? String(profile.employees) : null,
    ipoDate: null,
    country,
    countryIso: countryNameToIso(country),
    fund: null,
  };
}

/** A listing on a venue Sage has no suffix for is dropped: search must never
 *  offer a symbol Sage cannot then price. */
export function mapSearchResults(raw: TdSearch): SearchResult[] {
  const results: SearchResult[] = [];
  for (const row of raw.data) {
    const symbol = twelveDataToAppSymbol(row.symbol, row.mic_code);
    if (symbol === null) continue;
    results.push({
      symbol,
      name: row.instrument_name,
      exchange: row.exchange,
      currency: normalizeMinorUnit(row.currency).currency,
      assetType: mapAssetType(row.instrument_type),
    });
  }
  return results;
}
