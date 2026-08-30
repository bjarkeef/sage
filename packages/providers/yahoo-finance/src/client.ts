import YahooFinance from "yahoo-finance2";
import {
  ProviderRateLimitError,
  ProviderUnavailableError,
  SymbolNotFoundError,
} from "@sage/provider-interface";

export interface YfQuote {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketTime?: Date;
  currency?: string;
  exchange: string;
  shortName?: string;
  longName?: string;
  quoteType: string;
  // Fundamental fields
  marketCap?: number;
  trailingPE?: number;
  beta?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  trailingAnnualDividendYield?: number;
  trailingAnnualDividendRate?: number;
  sector?: string;
  industry?: string;
}

export interface YfChartQuote {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface YfChartDividend {
  amount: number;
  date: Date;
}

export interface YfChartMeta {
  currency: string;
  symbol: string;
  exchangeName: string;
}

export interface YfChartResult {
  meta: YfChartMeta;
  quotes: YfChartQuote[];
  events?: { dividends?: YfChartDividend[] };
}

export interface YfKeyStatistics {
  beta?: number;
  enterpriseValue?: number;
  forwardPE?: number;
  trailingEps?: number;
  priceToBook?: number;
}

export interface YfFundHolding {
  symbol?: string;
  holdingName?: string;
  holdingPercent?: number;
}

/** Yahoo reports sector weights as an array of single-key objects, e.g. `{ technology: 0.21 }`. */
export type YfSectorWeighting = Record<string, number>;

export interface YfTopHoldings {
  holdings?: YfFundHolding[];
  sectorWeightings?: YfSectorWeighting[];
}

export interface YfFundProfile {
  family?: string;
  categoryName?: string;
  legalType?: string;
  feesExpensesInvestment?: { annualReportExpenseRatio?: number };
}

export interface YfSummaryDetail {
  totalAssets?: number;
  payoutRatio?: number;
}

export interface YfCompanyOfficer {
  name?: string;
  title?: string;
}

/** Yahoo's `assetProfile` module: company-level descriptive fields. */
export interface YfAssetProfile {
  website?: string;
  longBusinessSummary?: string;
  sector?: string;
  industry?: string;
  country?: string;
  fullTimeEmployees?: number;
  companyOfficers?: YfCompanyOfficer[];
}

export interface YfSummaryResult {
  defaultKeyStatistics?: YfKeyStatistics;
  assetProfile?: YfAssetProfile;
  fundProfile?: YfFundProfile;
  topHoldings?: YfTopHoldings;
  summaryDetail?: YfSummaryDetail;
}

export interface YfSearchQuote {
  symbol: string;
  exchange: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  isYahooFinance: boolean;
}

export interface YfNewsThumbnailResolution {
  url: string;
  width: number;
  height: number;
  tag: string;
}
export interface YfSearchNews {
  title: string;
  publisher: string;
  link: string;
  providerPublishTime: Date;
  thumbnail?: { resolutions: YfNewsThumbnailResolution[] };
  relatedTickers?: string[];
}

export interface YfRecommendationTrendRow {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}
export interface YfFinancialData {
  currentPrice?: number;
  targetHighPrice?: number;
  targetLowPrice?: number;
  targetMeanPrice?: number;
  targetMedianPrice?: number;
  recommendationKey?: string;
  numberOfAnalystOpinions?: number;
}
export interface YfUpgradeDowngradeRow {
  epochGradeDate: Date;
  firm: string;
  toGrade: string;
  fromGrade?: string;
  action: string;
}
export interface YfPriceModule {
  currency?: string;
  regularMarketPrice?: number;
}
export interface YfRatingsResult {
  recommendationTrend?: { trend: YfRecommendationTrendRow[] };
  financialData?: YfFinancialData;
  upgradeDowngradeHistory?: { history: YfUpgradeDowngradeRow[] };
  price?: YfPriceModule;
}

export interface YfSearchResult {
  quotes: YfSearchQuote[];
  news?: YfSearchNews[];
}

export class YahooFinanceClient {
  private readonly yf: InstanceType<typeof YahooFinance>;

  constructor() {
    this.yf = new YahooFinance();
  }

  async quote(symbol: string): Promise<YfQuote> {
    // yahoo-finance2 does NOT throw for an unknown single symbol — quote()
    // resolves `undefined` (confirmed empirically against the live API on
    // yahoo-finance2@4.0.2; see the final-fix report). Detect that here so
    // callers get a `YfQuote` as the type promises, and so the failure is
    // SymbolNotFoundError rather than a downstream TypeError from mapping code
    // that assumed a defined result.
    const raw = await this.wrap<YfQuote | undefined>(
      symbol,
      () => this.yf.quote(symbol) as Promise<YfQuote | undefined>,
    );
    if (!raw) throw new SymbolNotFoundError(symbol);
    return raw;
  }

  async chart(symbol: string, from: Date, to: Date): Promise<YfChartResult> {
    return this.wrap<YfChartResult>(symbol, () =>
      this.yf.chart(symbol, {
        period1: from,
        period2: to,
        interval: "1d",
        events: "div",
        return: "array",
      }),
    );
  }

  async quoteSummary(symbol: string): Promise<YfSummaryResult> {
    return this.wrap<YfSummaryResult>(
      symbol,
      () =>
        this.yf.quoteSummary(symbol, {
          modules: ["defaultKeyStatistics", "assetProfile", "summaryDetail"],
        }) as unknown as Promise<YfSummaryResult>,
    );
  }

  /** Fund/ETF-only modules. Requested separately so the stock path is untouched. */
  async fundSummary(symbol: string): Promise<YfSummaryResult> {
    return this.wrap<YfSummaryResult>(
      symbol,
      () =>
        this.yf.quoteSummary(symbol, {
          modules: ["fundProfile", "topHoldings", "summaryDetail"],
        }) as unknown as Promise<YfSummaryResult>,
    );
  }

  async search(query: string): Promise<YfSearchResult> {
    return this.wrap<YfSearchResult>(
      query,
      () => this.yf.search(query, { quotesCount: 20 }) as Promise<YfSearchResult>,
    );
  }

  async news(symbol: string): Promise<YfSearchNews[]> {
    const res = await this.wrap<YfSearchResult>(
      symbol,
      () => this.yf.search(symbol, { newsCount: 12, quotesCount: 1 }) as Promise<YfSearchResult>,
    );
    return res.news ?? [];
  }

  async ratingsSummary(symbol: string): Promise<YfRatingsResult> {
    return this.wrap<YfRatingsResult>(symbol, () =>
      this.yf.quoteSummary(symbol, {
        modules: ["recommendationTrend", "financialData", "upgradeDowngradeHistory", "price"],
      }),
    );
  }

  /**
   * `identifier` is the app-level symbol (or, for `search`/`news`, the raw
   * query) attached to a `SymbolNotFoundError` when the failure is Yahoo
   * saying it has never heard of it — so that failure reads as the ordinary
   * "outside this provider's universe" case, not an outage
   * (`apps/api/src/market-data/provider-health.ts`).
   *
   * yahoo-finance2 has no typed error class for "not found" — it surfaces
   * Yahoo's own backend error description as a plain `Error`, so this has to
   * match on message text. Both substrings were confirmed empirically against
   * the live API on yahoo-finance2@4.0.2: `chart()` throws
   * "No data found, symbol may be delisted" (yahoo-finance2's own docs
   * recommend matching this exact text), and `quoteSummary()` throws
   * "Quote not found for symbol: <SYMBOL>", which is Yahoo's backend
   * `error.description` passed straight through.
   */
  private async wrap<T>(identifier: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Too Many Requests") || error.message.includes("429")) {
          throw new ProviderRateLimitError();
        }
        if (error.message.includes("No data found") || error.message.includes("Quote not found")) {
          throw new SymbolNotFoundError(identifier);
        }
      }
      throw new ProviderUnavailableError("Yahoo Finance request failed", { cause: error });
    }
  }
}
