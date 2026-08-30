import type { Money, Decimal, CurrencyCode } from "@sage/core";

/** A point-in-time price for a symbol. */
export interface Quote {
  symbol: string;
  price: Money;
  asOf: Date;
  /** The prior session's closing price, for day-over-day change. Null when the
   *  provider doesn't return it. */
  previousClose: Money | null;
}

/** One historical price bar (open/high/low/close in the instrument's currency). */
export interface PriceBar {
  date: Date;
  open: Money;
  high: Money;
  low: Money;
  close: Money;
  volume: Decimal; // a share count, not money
}

/** A single dividend distribution (amount is per share). Dates a provider omits are null. */
export interface Dividend {
  symbol: string;
  amountPerShare: Money;
  exDividendDate: Date;
  paymentDate: Date | null;
  announcedDate: Date | null;
  recordDate: Date | null;
  /** Provider-reported cadence, e.g. "Monthly", "Quarterly". Null when unknown. */
  period: string | null;
}

/** Broad category of a tradable asset; shown to users via plain-language labels. */
export type AssetType = "stock" | "etf" | "fund" | "index" | "other";

/** A symbol-search match. */
export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  currency: CurrencyCode;
  assetType: AssetType;
}

/** One position inside a fund/ETF. `weight` is a fraction (0.05 = 5%). */
export interface FundHolding {
  name: string;
  symbol: string | null;
  weight: number;
}

/** A fund's exposure to one sector. `weight` is a fraction (0.22 = 22%). */
export interface SectorWeight {
  sector: string;
  weight: number;
}

/** ETF/fund-specific fundamentals, present only on fund-type assets. */
export interface FundProfile {
  expenseRatio: Decimal | null; // fraction, e.g. 0.0038 for 0.38%
  totalAssets: Decimal | null; // assets under management
  family: string | null; // e.g. "VanEck"
  category: string | null;
  legalType: string | null; // e.g. "Exchange Traded Fund"
  holdings: FundHolding[]; // top holdings, weight-descending
  sectorWeightings: SectorWeight[];
}

/** Fundamental data for an asset. Nullable fields mean the provider doesn't have this data. */
export interface AssetProfile {
  symbol: string;
  name: string;
  exchange: string;
  currency: CurrencyCode;
  assetType: AssetType;
  sector: string | null;
  industry: string | null;
  marketCap: Decimal | null;
  peRatio: Decimal | null;
  beta: Decimal | null;
  fiftyTwoWeekHigh: Money | null;
  fiftyTwoWeekLow: Money | null;
  dividendYield: Decimal | null;
  /** Trailing dividend payout ratio as a fraction (e.g. 0.25 = 25%); null when unknown. */
  payoutRatio: Decimal | null;
  trailingAnnualDividend: Money | null;
  website: string | null;
  description: string | null;
  ceo: string | null;
  fullTimeEmployees: string | null;
  ipoDate: string | null;
  country: string | null;
  countryIso: string | null;
  /** Fund-only fundamentals; null for non-fund assets (stocks etc.). */
  fund: FundProfile | null;
}

/** One news article related to a symbol. */
export interface NewsArticle {
  title: string;
  publisher: string;
  url: string; // also the dedupe key for the aggregated feed
  publishedAt: Date;
  thumbnailUrl: string | null;
  relatedSymbols: string[]; // upper-cased tickers
}

/** Coarse analyst consensus bucket. */
export type AnalystConsensus = "strongBuy" | "buy" | "hold" | "sell" | "strongSell";

/** A single analyst rating change (upgrade/downgrade/initiation). */
export interface RatingChange {
  firm: string;
  fromGrade: string | null;
  toGrade: string;
  action: string; // Yahoo: "up" | "down" | "init" | "main" | "reit"
  date: Date;
}

/** Aggregated analyst view for a symbol. `null` from a provider means no coverage. */
export interface AnalystRatings {
  consensusKey: AnalystConsensus | null;
  distribution: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  };
  targets: {
    low: Money | null;
    mean: Money | null;
    high: Money | null;
    median: Money | null;
  };
  currentPrice: Money | null;
  analystCount: number;
  asOf: Date;
  upgradeHistory: RatingChange[]; // most-recent first, capped
}
