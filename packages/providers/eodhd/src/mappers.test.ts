import { describe, it, expect } from "vitest";
import { mapQuote, mapPriceBar, mapDividend, mapSearchResult, mapAssetProfile } from "./mappers";
import type {
  EodBar,
  RealTimeQuote,
  DividendItem,
  SearchResult as EodhdSearchResult,
  FundamentalsResponse,
} from "./schemas";

describe("mapQuote", () => {
  it("maps real-time quote to Quote", () => {
    const raw: RealTimeQuote = {
      code: "AAPL",
      timestamp: 1719500000,
      gmtoffset: 0,
      open: 190.0,
      high: 195.0,
      low: 189.0,
      close: 193.5,
      volume: 50000000,
    };
    const result = mapQuote(raw, "USD");
    expect(result.symbol).toBe("AAPL");
    expect(result.price.toJSON()).toEqual({ amount: "193.5", currency: "USD" });
  });

  it("maps previousClose when present", () => {
    const raw: RealTimeQuote = {
      code: "AAPL",
      timestamp: 1719500000,
      gmtoffset: 0,
      open: 190.0,
      high: 195.0,
      low: 189.0,
      close: 193.5,
      volume: 50000000,
      previousClose: 191.0,
    };
    expect(mapQuote(raw, "USD").previousClose!.toJSON()).toEqual({
      amount: "191",
      currency: "USD",
    });
  });

  it("has a null previousClose when EODHD omits it", () => {
    const raw: RealTimeQuote = {
      code: "AAPL",
      timestamp: 1719500000,
      gmtoffset: 0,
      open: 190.0,
      high: 195.0,
      low: 189.0,
      close: 193.5,
      volume: 50000000,
    };
    expect(mapQuote(raw, "USD").previousClose).toBeNull();
  });
});

describe("mapPriceBar", () => {
  it("maps EOD bar to PriceBar", () => {
    const bar: EodBar = {
      date: "2026-06-27",
      open: 190,
      high: 195,
      low: 189,
      close: 193,
      adjusted_close: 193,
      volume: 50000000,
    };
    const result = mapPriceBar(bar, "USD");
    expect(result.date).toEqual(new Date("2026-06-27T00:00:00Z"));
    expect(result.close.toJSON()).toEqual({ amount: "193", currency: "USD" });
    expect(result.volume.toFixed()).toBe("50000000");
  });
});

describe("mapDividend", () => {
  it("maps dividend item with payment date", () => {
    const item: DividendItem = {
      date: "2026-05-10",
      value: 0.25,
      currency: "USD",
      paymentDate: "2026-05-30",
      declarationDate: "2026-04-15",
    };
    const result = mapDividend(item, "AAPL", "USD");
    expect(result.amountPerShare.toJSON()).toEqual({ amount: "0.25", currency: "USD" });
    expect(result.paymentDate).toEqual(new Date("2026-05-30T00:00:00Z"));
    expect(result.announcedDate).toEqual(new Date("2026-04-15T00:00:00Z"));
  });

  it("handles null payment date", () => {
    const item: DividendItem = { date: "2026-05-10", value: 0.5 };
    const result = mapDividend(item, "AAPL", "USD");
    expect(result.paymentDate).toBeNull();
    expect(result.announcedDate).toBeNull();
  });

  it("maps recordDate and period from the EODHD payload", () => {
    const dividend = mapDividend(
      {
        date: "2026-06-30",
        value: 0.271,
        currency: "USD",
        declarationDate: "2026-06-09",
        recordDate: "2026-06-30",
        paymentDate: "2026-07-15",
        period: "Monthly",
        unadjustedValue: 0.271,
      },
      "O",
      "USD",
    );
    expect(dividend.recordDate).toEqual(new Date("2026-06-30T00:00:00Z"));
    expect(dividend.period).toBe("Monthly");
  });
});

describe("mapSearchResult", () => {
  it("maps EODHD search result", () => {
    const item: EodhdSearchResult = {
      Code: "AAPL",
      Exchange: "US",
      Name: "Apple Inc",
      Type: "Common Stock",
      Country: "USA",
      Currency: "USD",
      ISIN: "US0378331005",
    };
    const result = mapSearchResult(item);
    expect(result.symbol).toBe("AAPL");
    expect(result.assetType).toBe("stock");
    expect(result.currency).toBe("USD");
  });

  it("detects ETF type", () => {
    const item: EodhdSearchResult = {
      Code: "VTI",
      Exchange: "US",
      Name: "Vanguard Total Stock ETF",
      Type: "ETF",
      Country: "USA",
      Currency: "USD",
    };
    expect(mapSearchResult(item).assetType).toBe("etf");
  });

  it("emits app-format symbols (suffix from exchange)", () => {
    const result = mapSearchResult({
      Code: "EUDIV",
      Exchange: "XETRA",
      Name: "Euro Dividend Leaders",
      Type: "ETF",
      Country: "Germany",
      Currency: "EUR",
      ISIN: "NL0011683594",
      previousClose: 51.9,
      previousCloseDate: "2026-07-01",
    });
    expect(result.symbol).toBe("EUDIV.DE");
    expect(result.exchange).toBe("XETRA");
  });

  it("emits bare codes for US listings", () => {
    const result = mapSearchResult({
      Code: "AAPL",
      Exchange: "US",
      Name: "Apple Inc",
      Type: "Common Stock",
      Country: "USA",
      Currency: "USD",
      ISIN: "US0378331005",
      previousClose: 308.6,
      previousCloseDate: "2026-07-01",
    });
    expect(result.symbol).toBe("AAPL");
  });
});

describe("mapAssetProfile", () => {
  it("maps fundamentals response", () => {
    const data: FundamentalsResponse = {
      General: {
        Code: "AAPL",
        Name: "Apple Inc",
        Exchange: "NASDAQ",
        CurrencyCode: "USD",
        CountryName: "USA",
        CountryISO: "US",
        Sector: "Technology",
        Industry: "Consumer Electronics",
        WebURL: "https://apple.com",
        Description: "Tech company",
        IPODate: "1980-12-12",
        FullTimeEmployees: 164000,
        Officers: { "0": { Name: "Tim Cook", Title: "CEO" } },
      },
      Highlights: {
        MarketCapitalization: 3000000000000,
        PERatio: 32.5,
        DividendYield: 0.52,
      },
      Technicals: {
        Beta: 1.28,
        "52WeekHigh": 237.49,
        "52WeekLow": 164.08,
      },
      SplitsDividends: {
        TrailingAnnualDividendRate: 1.0,
      },
    };
    const result = mapAssetProfile(data);
    expect(result.symbol).toBe("AAPL");
    expect(result.country).toBe("USA");
    expect(result.countryIso).toBe("US");
    expect(result.sector).toBe("Technology");
    expect(result.ceo).toBe("Tim Cook");
    expect(result.marketCap?.toFixed()).toBe("3000000000000");
    expect(result.fiftyTwoWeekHigh?.toJSON()).toEqual({ amount: "237.49", currency: "USD" });
  });
});
