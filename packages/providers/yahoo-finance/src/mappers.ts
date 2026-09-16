import { Money, Decimal, moneyFromMinorUnit } from "@sage/core";
import type {
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetType,
  AssetProfile,
  FundProfile,
  NewsArticle,
  AnalystRatings,
  AnalystConsensus,
} from "@sage/provider-interface";
import type {
  YfQuote,
  YfChartQuote,
  YfChartDividend,
  YfSummaryResult,
  YfAssetProfile,
  YfSearchNews,
  YfRatingsResult,
} from "./client";
import { countryNameToIso } from "@sage/provider-interface";
import { exchangeToCurrency } from "./currency";

// Yahoo reports LSE (and a few other) values in minor units like `GBp` (pence);
// normalize every amount to the major-unit ISO currency.
function money(amount: number, currency: string): Money {
  return moneyFromMinorUnit(new Decimal(amount), currency);
}

export function mapQuote(raw: YfQuote): Quote | null {
  if (raw.regularMarketPrice == null || !raw.currency) return null;
  return {
    symbol: raw.symbol,
    price: money(raw.regularMarketPrice, raw.currency),
    asOf: raw.regularMarketTime ?? new Date(),
    previousClose:
      raw.regularMarketPreviousClose != null
        ? money(raw.regularMarketPreviousClose, raw.currency)
        : null,
  };
}

export function mapPriceBar(bar: YfChartQuote, currency: string): PriceBar | null {
  const { open, high, low, close, volume } = bar;
  if (open == null || high == null || low == null || close == null || volume == null) return null;
  return {
    date: bar.date,
    open: money(open, currency),
    high: money(high, currency),
    low: money(low, currency),
    close: money(close, currency),
    volume: new Decimal(volume),
  };
}

export function mapDividend(event: YfChartDividend, symbol: string, currency: string): Dividend {
  return {
    symbol,
    amountPerShare: money(event.amount, currency),
    exDividendDate: event.date,
    paymentDate: null,
    announcedDate: null,
    recordDate: null,
    period: null,
  };
}

function mapQuoteType(quoteType: string): AssetType {
  switch (quoteType) {
    case "EQUITY":
      return "stock";
    case "ETF":
      return "etf";
    case "MUTUALFUND":
      return "fund";
    case "INDEX":
      return "index";
    default:
      return "other";
  }
}

export function mapSearchResult(item: {
  symbol: string;
  exchange: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
}): SearchResult | null {
  const currency = exchangeToCurrency(item.exchange);
  if (!currency) return null;
  return {
    symbol: item.symbol,
    name: item.longname ?? item.shortname ?? item.symbol,
    exchange: item.exchange,
    currency,
    assetType: mapQuoteType(item.quoteType ?? ""),
  };
}

export function mapAssetProfile(raw: YfQuote): AssetProfile | null {
  if (!raw.currency) return null;
  return {
    symbol: raw.symbol,
    name: raw.longName ?? raw.shortName ?? raw.symbol,
    exchange: raw.exchange,
    currency: raw.currency,
    assetType: mapQuoteType(raw.quoteType),
    sector: raw.sector ?? null,
    industry: raw.industry ?? null,
    marketCap: raw.marketCap != null ? new Decimal(raw.marketCap) : null,
    peRatio: raw.trailingPE != null ? new Decimal(raw.trailingPE) : null,
    beta: raw.beta != null ? new Decimal(raw.beta) : null,
    fiftyTwoWeekHigh:
      raw.fiftyTwoWeekHigh != null ? money(raw.fiftyTwoWeekHigh, raw.currency) : null,
    fiftyTwoWeekLow: raw.fiftyTwoWeekLow != null ? money(raw.fiftyTwoWeekLow, raw.currency) : null,
    dividendYield:
      raw.trailingAnnualDividendYield != null ? new Decimal(raw.trailingAnnualDividendYield) : null,
    payoutRatio: null,
    trailingAnnualDividend:
      raw.trailingAnnualDividendRate != null
        ? money(raw.trailingAnnualDividendRate, raw.currency)
        : null,
    website: null,
    description: null,
    ceo: null,
    fullTimeEmployees: null,
    ipoDate: null,
    country: null,
    countryIso: null,
    fund: null,
  };
}

/** The company officer whose title names them chief executive, if any. */
function findCeo(officers: YfAssetProfile["companyOfficers"]): string | null {
  const ceo = officers?.find((o) => /chief executive|\bceo\b/i.test(o.title ?? ""));
  return ceo?.name ?? null;
}

/** Merge Yahoo's `assetProfile` module (website, description, country, CEO,
 *  headcount) onto a base profile built from the quote. The quote carries none
 *  of these company-level fields, so `mapAssetProfile` leaves them null and this
 *  fills them when the module is present. Existing non-null values win — the
 *  quote is authoritative for sector/industry when it already provided them. */
export function applyAssetProfileModule(
  profile: AssetProfile,
  ap: YfAssetProfile | undefined,
): AssetProfile {
  if (!ap) return profile;
  return {
    ...profile,
    website: profile.website ?? ap.website ?? null,
    description: profile.description ?? ap.longBusinessSummary ?? null,
    sector: profile.sector ?? ap.sector ?? null,
    industry: profile.industry ?? ap.industry ?? null,
    country: profile.country ?? ap.country ?? null,
    // Yahoo reports a country NAME and no code, but the contract asks for an
    // ISO code and `countryToRegion` keys on it — so leaving this null put
    // every holding in `Unknown` on the region card. Derived from whichever
    // name we end up with, so it stays consistent with the country card.
    countryIso: profile.countryIso ?? countryNameToIso(profile.country ?? ap.country),
    fullTimeEmployees:
      profile.fullTimeEmployees ??
      (ap.fullTimeEmployees != null ? String(ap.fullTimeEmployees) : null),
    ceo: profile.ceo ?? findCeo(ap.companyOfficers),
  };
}

/** Build a {@link FundProfile} from Yahoo's fund/ETF quoteSummary modules. */
export function mapFundProfile(summary: YfSummaryResult): FundProfile {
  const fp = summary.fundProfile;
  const th = summary.topHoldings;
  const sd = summary.summaryDetail;

  // Thin cross-listings (e.g. *.DE) often report 0 for these instead of omitting
  // them — treat a non-positive value as "no data" rather than a real 0%.
  const expenseRatio = fp?.feesExpensesInvestment?.annualReportExpenseRatio;
  const totalAssets = sd?.totalAssets;

  return {
    expenseRatio: expenseRatio != null && expenseRatio > 0 ? new Decimal(expenseRatio) : null,
    totalAssets: totalAssets != null && totalAssets > 0 ? new Decimal(totalAssets) : null,
    family: fp?.family ?? null,
    category: fp?.categoryName ?? null,
    legalType: fp?.legalType ?? null,
    holdings: (th?.holdings ?? []).map((h) => ({
      name: h.holdingName ?? h.symbol ?? "",
      symbol: h.symbol ?? null,
      weight: h.holdingPercent ?? 0,
    })),
    // Yahoo returns one single-key object per sector; flatten and drop zero weights.
    sectorWeightings: (th?.sectorWeightings ?? [])
      .flatMap((entry) => Object.entries(entry).map(([sector, weight]) => ({ sector, weight })))
      .filter((s) => s.weight > 0),
  };
}

export function mapNewsArticle(raw: YfSearchNews): NewsArticle {
  const resolutions = raw.thumbnail?.resolutions ?? [];
  const smallest = resolutions.length
    ? resolutions.reduce((a, b) => (a.width <= b.width ? a : b))
    : null;
  return {
    title: raw.title,
    publisher: raw.publisher,
    url: raw.link,
    publishedAt: raw.providerPublishTime,
    thumbnailUrl: smallest?.url ?? null,
    relatedSymbols: (raw.relatedTickers ?? []).map((t) => t.toUpperCase()),
  };
}

function keyToConsensus(key: string | undefined): AnalystConsensus | null {
  switch (key) {
    case "strong_buy":
      return "strongBuy";
    case "buy":
    case "outperform":
      return "buy";
    case "hold":
      return "hold";
    case "sell":
    case "underperform":
      return "sell";
    case "strong_sell":
      return "strongSell";
    default:
      return null;
  }
}

export function mapAnalystRatings(raw: YfRatingsResult, asOf: Date): AnalystRatings | null {
  const fd = raw.financialData;
  const trend = raw.recommendationTrend?.trend?.[0];
  const analystCount = fd?.numberOfAnalystOpinions ?? 0;
  const trendTotal = trend
    ? trend.strongBuy + trend.buy + trend.hold + trend.sell + trend.strongSell
    : 0;
  // No coverage: no analysts AND no non-zero recommendation distribution.
  if (analystCount === 0 && trendTotal === 0) return null;

  const currency = raw.price?.currency ?? null;
  const m = (n: number | undefined) =>
    n != null && currency ? moneyFromMinorUnit(new Decimal(n), currency) : null;

  const distribution = trend
    ? {
        strongBuy: trend.strongBuy,
        buy: trend.buy,
        hold: trend.hold,
        sell: trend.sell,
        strongSell: trend.strongSell,
      }
    : { strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 };

  const upgradeHistory = (raw.upgradeDowngradeHistory?.history ?? [])
    .slice()
    .sort((a, b) => b.epochGradeDate.getTime() - a.epochGradeDate.getTime())
    .slice(0, 15)
    .map((h) => ({
      firm: h.firm,
      fromGrade: h.fromGrade ?? null,
      toGrade: h.toGrade,
      action: h.action,
      date: h.epochGradeDate,
    }));

  return {
    consensusKey: keyToConsensus(fd?.recommendationKey),
    distribution,
    targets: {
      low: m(fd?.targetLowPrice),
      mean: m(fd?.targetMeanPrice),
      high: m(fd?.targetHighPrice),
      median: m(fd?.targetMedianPrice),
    },
    currentPrice: m(fd?.currentPrice ?? raw.price?.regularMarketPrice),
    analystCount,
    asOf,
    upgradeHistory,
  };
}
