import { describe, it, expect } from "vitest";
import { Decimal } from "@sage/core";
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
import type {
  YfQuote,
  YfChartQuote,
  YfChartDividend,
  YfSummaryResult,
  YfSearchNews,
  YfRatingsResult,
} from "./client";

describe("mapQuote", () => {
  it("maps a valid quote", () => {
    const raw: YfQuote = {
      symbol: "AAPL",
      regularMarketPrice: 195.5,
      regularMarketTime: new Date("2026-06-20T16:00:00Z"),
      currency: "USD",
      exchange: "NMS",
      quoteType: "EQUITY",
    };
    const q = mapQuote(raw);
    expect(q).not.toBeNull();
    expect(q!.symbol).toBe("AAPL");
    expect(q!.price.amount.equals(new Decimal("195.5"))).toBe(true);
    expect(q!.price.currency).toBe("USD");
    expect(q!.asOf).toEqual(new Date("2026-06-20T16:00:00Z"));
  });

  it("returns null when regularMarketPrice is missing", () => {
    const raw: YfQuote = {
      symbol: "AAPL",
      currency: "USD",
      exchange: "NMS",
      quoteType: "EQUITY",
    };
    expect(mapQuote(raw)).toBeNull();
  });

  it("returns null when currency is missing", () => {
    const raw: YfQuote = {
      symbol: "AAPL",
      regularMarketPrice: 195.5,
      exchange: "NMS",
      quoteType: "EQUITY",
    };
    expect(mapQuote(raw)).toBeNull();
  });

  it("normalizes a GBp (pence) price into GBP pounds", () => {
    const raw: YfQuote = {
      symbol: "ALBION.L",
      regularMarketPrice: 7250,
      regularMarketTime: new Date("2026-06-20T16:00:00Z"),
      currency: "GBp",
      exchange: "LSE",
      quoteType: "EQUITY",
    };
    const q = mapQuote(raw);
    expect(q!.price.toJSON()).toEqual({ amount: "72.5", currency: "GBP" });
  });

  it("maps regularMarketPreviousClose into previousClose", () => {
    const raw: YfQuote = {
      symbol: "AAPL",
      regularMarketPrice: 195.5,
      regularMarketPreviousClose: 192.0,
      currency: "USD",
      exchange: "NMS",
      quoteType: "EQUITY",
    };
    const q = mapQuote(raw);
    expect(q!.previousClose!.amount.equals(new Decimal("192"))).toBe(true);
    expect(q!.previousClose!.currency).toBe("USD");
  });

  it("has a null previousClose when Yahoo omits it", () => {
    const raw: YfQuote = {
      symbol: "AAPL",
      regularMarketPrice: 195.5,
      currency: "USD",
      exchange: "NMS",
      quoteType: "EQUITY",
    };
    expect(mapQuote(raw)!.previousClose).toBeNull();
  });

  it("normalizes a GBp previous close into GBP pounds", () => {
    const raw: YfQuote = {
      symbol: "ALBION.L",
      regularMarketPrice: 7250,
      regularMarketPreviousClose: 7100,
      currency: "GBp",
      exchange: "LSE",
      quoteType: "EQUITY",
    };
    expect(mapQuote(raw)!.previousClose!.toJSON()).toEqual({ amount: "71", currency: "GBP" });
  });
});

describe("mapPriceBar", () => {
  it("maps a complete bar", () => {
    const bar: YfChartQuote = {
      date: new Date("2026-06-20"),
      open: 193.0,
      high: 196.0,
      low: 192.5,
      close: 195.5,
      volume: 50_000_000,
    };
    const result = mapPriceBar(bar, "USD");
    expect(result).not.toBeNull();
    expect(result!.open.amount.equals(new Decimal("193"))).toBe(true);
    expect(result!.volume.equals(new Decimal(50_000_000))).toBe(true);
  });

  it("returns null when a price field is null", () => {
    const bar: YfChartQuote = {
      date: new Date("2026-06-20"),
      open: null,
      high: 196.0,
      low: 192.5,
      close: 195.5,
      volume: 50_000_000,
    };
    expect(mapPriceBar(bar, "USD")).toBeNull();
  });
});

describe("mapDividend", () => {
  it("maps a dividend event", () => {
    const event: YfChartDividend = {
      amount: 0.25,
      date: new Date("2026-05-10"),
    };
    const d = mapDividend(event, "AAPL", "USD");
    expect(d.symbol).toBe("AAPL");
    expect(d.amountPerShare.amount.equals(new Decimal("0.25"))).toBe(true);
    expect(d.amountPerShare.currency).toBe("USD");
    expect(d.exDividendDate).toEqual(new Date("2026-05-10"));
    expect(d.paymentDate).toBeNull();
    expect(d.announcedDate).toBeNull();
  });

  it("normalizes a GBp (pence) dividend into GBP pounds", () => {
    const event: YfChartDividend = { amount: 15, date: new Date("2026-05-10") };
    const d = mapDividend(event, "ALBION.L", "GBp");
    expect(d.amountPerShare.toJSON()).toEqual({ amount: "0.15", currency: "GBP" });
  });
});

describe("mapSearchResult", () => {
  it("maps a known-exchange result", () => {
    const item = {
      symbol: "AAPL",
      exchange: "NMS",
      longname: "Apple Inc.",
      quoteType: "EQUITY",
    };
    const r = mapSearchResult(item);
    expect(r).not.toBeNull();
    expect(r!.symbol).toBe("AAPL");
    expect(r!.name).toBe("Apple Inc.");
    expect(r!.currency).toBe("USD");
    expect(r!.assetType).toBe("stock");
  });

  it("falls back to shortname then symbol for name", () => {
    expect(mapSearchResult({ symbol: "X", exchange: "NYQ", shortname: "Short" })!.name).toBe(
      "Short",
    );
    expect(mapSearchResult({ symbol: "X", exchange: "NYQ" })!.name).toBe("X");
  });

  it("returns null for unknown exchange", () => {
    expect(mapSearchResult({ symbol: "X", exchange: "UNKNOWN_EX" })).toBeNull();
  });

  it("maps ETF quoteType", () => {
    const r = mapSearchResult({ symbol: "SPY", exchange: "PCX", quoteType: "ETF" });
    expect(r!.assetType).toBe("etf");
  });

  it("maps MUTUALFUND quoteType", () => {
    const r = mapSearchResult({ symbol: "VFIAX", exchange: "NMS", quoteType: "MUTUALFUND" });
    expect(r!.assetType).toBe("fund");
  });

  it("maps INDEX quoteType", () => {
    const r = mapSearchResult({ symbol: "^GSPC", exchange: "NYQ", quoteType: "INDEX" });
    expect(r!.assetType).toBe("index");
  });
});

describe("mapAssetProfile", () => {
  it("maps all fundamental fields from a YfQuote", () => {
    const raw = {
      symbol: "AAPL",
      exchange: "NMS",
      quoteType: "EQUITY",
      currency: "USD",
      longName: "Apple Inc",
      marketCap: 3000000000000,
      trailingPE: 30.5,
      beta: 1.2,
      fiftyTwoWeekHigh: 200,
      fiftyTwoWeekLow: 150,
      trailingAnnualDividendYield: 0.005,
      trailingAnnualDividendRate: 1.0,
      sector: "Technology",
      industry: "Consumer Electronics",
    };
    const result = mapAssetProfile(raw);
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe("AAPL");
    expect(result!.sector).toBe("Technology");
    expect(result!.marketCap!.toFixed()).toBe("3000000000000");
    expect(result!.peRatio!.toFixed(1)).toBe("30.5");
    expect(result!.fiftyTwoWeekHigh!.toString()).toBe("200");
    expect(result!.dividendYield!.toFixed(3)).toBe("0.005");
  });

  it("returns null fields for missing fundamentals", () => {
    const raw: YfQuote = {
      symbol: "AAPL",
      exchange: "NMS",
      quoteType: "EQUITY",
      currency: "USD",
    };
    const result = mapAssetProfile(raw);
    expect(result).not.toBeNull();
    expect(result!.sector).toBeNull();
    expect(result!.marketCap).toBeNull();
  });

  it("returns null when currency is missing", () => {
    const raw: YfQuote = { symbol: "AAPL", exchange: "NMS", quoteType: "EQUITY" };
    expect(mapAssetProfile(raw)).toBeNull();
  });

  it("leaves fund null for an equity", () => {
    const raw = { symbol: "AAPL", exchange: "NMS", quoteType: "EQUITY", currency: "USD" };
    expect(mapAssetProfile(raw)!.fund).toBeNull();
  });
});

describe("applyAssetProfileModule", () => {
  const base = () =>
    mapAssetProfile({ symbol: "AAPL", exchange: "NMS", quoteType: "EQUITY", currency: "USD" })!;

  it("fills website, description, country, headcount, and CEO from the module", () => {
    const result = applyAssetProfileModule(base(), {
      website: "https://www.apple.com",
      longBusinessSummary: "Apple designs phones.",
      country: "United States",
      fullTimeEmployees: 164000,
      companyOfficers: [
        { name: "Luca Maestri", title: "CFO" },
        { name: "Tim Cook", title: "Chief Executive Officer" },
      ],
    });
    expect(result.website).toBe("https://www.apple.com");
    expect(result.description).toBe("Apple designs phones.");
    expect(result.country).toBe("United States");
    expect(result.fullTimeEmployees).toBe("164000");
    expect(result.ceo).toBe("Tim Cook");
  });

  it("returns the profile unchanged when the module is absent", () => {
    const profile = base();
    expect(applyAssetProfileModule(profile, undefined)).toEqual(profile);
  });

  it("leaves CEO null when no officer has an executive title", () => {
    const result = applyAssetProfileModule(base(), {
      companyOfficers: [{ name: "Luca Maestri", title: "CFO" }],
    });
    expect(result.ceo).toBeNull();
  });

  it("keeps a sector the quote already provided instead of the module's", () => {
    const withSector = { ...base(), sector: "Technology" };
    const result = applyAssetProfileModule(withSector, { sector: "Electronics" });
    expect(result.sector).toBe("Technology");
  });
});

describe("mapFundProfile", () => {
  const summary: YfSummaryResult = {
    fundProfile: {
      family: "VanEck",
      categoryName: "Global Dividend",
      legalType: "Exchange Traded Fund",
      feesExpensesInvestment: { annualReportExpenseRatio: 0.0038 },
    },
    topHoldings: {
      holdings: [
        { symbol: "XOM", holdingName: "Exxon Mobil Corp", holdingPercent: 0.0562 },
        { symbol: "VZ", holdingName: "Verizon Communications Inc", holdingPercent: 0.0474 },
      ],
      sectorWeightings: [
        { realestate: 0 },
        { consumer_cyclical: 0.0381 },
        { consumer_defensive: 0.1 },
      ],
    },
    summaryDetail: { totalAssets: 7791531520 },
  };

  it("maps fund scalars, holdings, and non-zero sector weights", () => {
    const f = mapFundProfile(summary);
    expect(f.expenseRatio!.equals(new Decimal("0.0038"))).toBe(true);
    expect(f.totalAssets!.equals(new Decimal("7791531520"))).toBe(true);
    expect(f.family).toBe("VanEck");
    expect(f.category).toBe("Global Dividend");
    expect(f.legalType).toBe("Exchange Traded Fund");
    expect(f.holdings).toEqual([
      { name: "Exxon Mobil Corp", symbol: "XOM", weight: 0.0562 },
      { name: "Verizon Communications Inc", symbol: "VZ", weight: 0.0474 },
    ]);
    // The zero-weight real-estate entry is dropped.
    expect(f.sectorWeightings).toEqual([
      { sector: "consumer_cyclical", weight: 0.0381 },
      { sector: "consumer_defensive", weight: 0.1 },
    ]);
  });

  it("tolerates absent modules with empty/null fields", () => {
    const f = mapFundProfile({});
    expect(f.expenseRatio).toBeNull();
    expect(f.totalAssets).toBeNull();
    expect(f.family).toBeNull();
    expect(f.holdings).toEqual([]);
    expect(f.sectorWeightings).toEqual([]);
  });

  it("treats a zero expense ratio or AUM as missing (thin cross-listings report 0)", () => {
    const f = mapFundProfile({
      fundProfile: { feesExpensesInvestment: { annualReportExpenseRatio: 0 } },
      summaryDetail: { totalAssets: 0 },
    });
    expect(f.expenseRatio).toBeNull();
    expect(f.totalAssets).toBeNull();
  });
});

describe("mapAssetProfile payoutRatio", () => {
  it("initialises payoutRatio to null (quote carries none)", () => {
    const profile = mapAssetProfile({
      symbol: "AAPL",
      exchange: "NMS",
      quoteType: "EQUITY",
      currency: "USD",
      regularMarketPrice: 180,
    });
    expect(profile?.payoutRatio).toBeNull();
  });
});

describe("mapNewsArticle", () => {
  it("maps fields and picks the smallest thumbnail, upper-casing tickers", () => {
    const raw: YfSearchNews = {
      title: "Apple hits new high",
      publisher: "Reuters",
      link: "https://x/a",
      providerPublishTime: new Date("2026-07-20T10:00:00Z"),
      thumbnail: {
        resolutions: [
          { url: "big.jpg", width: 300, height: 200, tag: "original" },
          { url: "small.jpg", width: 140, height: 90, tag: "140x90" },
        ],
      },
      relatedTickers: ["aapl", "msft"],
    };
    expect(mapNewsArticle(raw)).toEqual({
      title: "Apple hits new high",
      publisher: "Reuters",
      url: "https://x/a",
      publishedAt: new Date("2026-07-20T10:00:00Z"),
      thumbnailUrl: "small.jpg",
      relatedSymbols: ["AAPL", "MSFT"],
    });
  });

  it("tolerates a missing thumbnail and tickers", () => {
    const raw: YfSearchNews = {
      title: "T",
      publisher: "P",
      link: "u",
      providerPublishTime: new Date("2026-07-20T10:00:00Z"),
    };
    const out = mapNewsArticle(raw);
    expect(out.thumbnailUrl).toBeNull();
    expect(out.relatedSymbols).toEqual([]);
  });
});

describe("mapAnalystRatings", () => {
  const asOf = new Date("2026-07-23T00:00:00Z");

  it("maps distribution, targets, consensus and sorted-capped history", () => {
    const raw: YfRatingsResult = {
      recommendationTrend: {
        trend: [{ period: "0m", strongBuy: 5, buy: 8, hold: 3, sell: 1, strongSell: 0 }],
      },
      financialData: {
        currentPrice: 190,
        targetLowPrice: 150,
        targetMeanPrice: 210,
        targetHighPrice: 260,
        targetMedianPrice: 205,
        recommendationKey: "buy",
        numberOfAnalystOpinions: 17,
      },
      upgradeDowngradeHistory: {
        history: [
          { epochGradeDate: new Date("2026-01-01"), firm: "Old", toGrade: "Buy", action: "main" },
          {
            epochGradeDate: new Date("2026-06-01"),
            firm: "New",
            toGrade: "Buy",
            fromGrade: "Hold",
            action: "up",
          },
        ],
      },
      price: { currency: "USD", regularMarketPrice: 190 },
    };
    const out = mapAnalystRatings(raw, asOf)!;
    expect(out.consensusKey).toBe("buy");
    expect(out.distribution).toEqual({ strongBuy: 5, buy: 8, hold: 3, sell: 1, strongSell: 0 });
    expect(out.analystCount).toBe(17);
    expect(out.targets.mean?.toJSON()).toEqual({ amount: "210", currency: "USD" });
    expect(out.currentPrice?.toJSON()).toEqual({ amount: "190", currency: "USD" });
    expect(out.asOf).toEqual(asOf);
    expect(out.upgradeHistory.map((h) => h.firm)).toEqual(["New", "Old"]); // most-recent first
  });

  it("returns null when there is no coverage (no trend and zero analysts)", () => {
    const raw: YfRatingsResult = {
      price: { currency: "USD" },
      financialData: { recommendationKey: "none" },
    };
    expect(mapAnalystRatings(raw, asOf)).toBeNull();
  });

  it("nulls targets when currency is unknown", () => {
    const raw: YfRatingsResult = {
      recommendationTrend: {
        trend: [{ period: "0m", strongBuy: 1, buy: 0, hold: 0, sell: 0, strongSell: 0 }],
      },
      financialData: { targetMeanPrice: 100, numberOfAnalystOpinions: 1 },
    };
    const out = mapAnalystRatings(raw, asOf)!;
    expect(out.targets.mean).toBeNull();
  });

  it("caps upgradeHistory at 15 entries, keeping the most recent", () => {
    const history = Array.from({ length: 17 }, (_, i) => ({
      epochGradeDate: new Date(2026, 0, i + 1),
      firm: i < 10 ? `Firm0${i}` : `Firm${i}`,
      toGrade: "Buy",
      action: "main" as const,
    }));
    const raw: YfRatingsResult = {
      recommendationTrend: {
        trend: [{ period: "0m", strongBuy: 5, buy: 8, hold: 3, sell: 1, strongSell: 0 }],
      },
      upgradeDowngradeHistory: { history },
      price: { currency: "USD", regularMarketPrice: 190 },
    };
    const out = mapAnalystRatings(raw, asOf)!;
    expect(out.upgradeHistory).toHaveLength(15);
    // First kept entry should be most recent: new Date(2026, 0, 17)
    expect(out.upgradeHistory[0]!.date).toEqual(new Date(2026, 0, 17));
    // Last kept entry should be: new Date(2026, 0, 3) (the 2 oldest were dropped)
    expect(out.upgradeHistory[14]!.date).toEqual(new Date(2026, 0, 3));
  });

  it("creates zero-distribution fallback when no trend but analysts exist", () => {
    const raw: YfRatingsResult = {
      financialData: { numberOfAnalystOpinions: 4 },
      price: { currency: "USD", regularMarketPrice: 190 },
    };
    const out = mapAnalystRatings(raw, asOf)!;
    expect(out).not.toBeNull();
    expect(out.distribution).toEqual({ strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 });
    expect(out.analystCount).toBe(4);
  });

  it("treats an all-zero distribution with zero analysts as no coverage", () => {
    const raw: YfRatingsResult = {
      recommendationTrend: {
        trend: [{ period: "0m", strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 }],
      },
      financialData: { numberOfAnalystOpinions: 0, recommendationKey: "none" },
      price: { currency: "USD" },
    };
    expect(mapAnalystRatings(raw, asOf)).toBeNull();
  });

  it("falls back to price.regularMarketPrice when financialData.currentPrice is absent", () => {
    const raw: YfRatingsResult = {
      recommendationTrend: {
        trend: [{ period: "0m", strongBuy: 1, buy: 0, hold: 0, sell: 0, strongSell: 0 }],
      },
      financialData: { numberOfAnalystOpinions: 1 },
      price: { currency: "USD", regularMarketPrice: 188 },
    };
    const out = mapAnalystRatings(raw, asOf)!;
    expect(out.currentPrice?.toJSON()).toEqual({ amount: "188", currency: "USD" });
  });
});
