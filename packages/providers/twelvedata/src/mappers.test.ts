import { describe, it, expect } from "vitest";
import { ProviderUnavailableError } from "@sage/provider-interface";
import {
  AAPL_QUOTE,
  VOO_QUOTE,
  PENCE_QUOTE,
  AAPL_TIME_SERIES,
  AAPL_DIVIDENDS,
  AAPL_PROFILE,
  SEARCH_RESULTS,
} from "./fixtures";
import {
  parse,
  quoteSchema,
  timeSeriesSchema,
  dividendsSchema,
  profileSchema,
  searchSchema,
} from "./schemas";
import {
  mapQuote,
  mapPriceBars,
  mapDividends,
  mapAssetProfile,
  mapSearchResults,
  mapAssetType,
} from "./mappers";

describe("mapQuote", () => {
  it("prices from close, with the prior close and the last trade time", () => {
    const q = mapQuote(parse(quoteSchema, AAPL_QUOTE), "AAPL");
    expect(q.symbol).toBe("AAPL");
    expect(q.price.toDecimal().toFixed()).toBe("332.695");
    expect(q.price.currency).toBe("USD");
    expect(q.previousClose?.toDecimal().toFixed()).toBe("331.34");
    expect(q.asOf).toEqual(new Date(1789574220 * 1000));
  });

  it("falls back to the bar timestamp when there is no last trade time", () => {
    const q = mapQuote(parse(quoteSchema, PENCE_QUOTE), "THAMES.L");
    expect(q.asOf).toEqual(new Date(1789545600 * 1000));
  });

  /** A pence price read as pounds makes a London holding 100x too big. */
  it("converts pence to pounds", () => {
    const q = mapQuote(parse(quoteSchema, PENCE_QUOTE), "THAMES.L");
    expect(q.price.currency).toBe("GBP");
    expect(q.price.toDecimal().toFixed()).toBe("12.505");
    expect(q.previousClose?.toDecimal().toFixed()).toBe("12.4");
  });
});

describe("mapPriceBars", () => {
  it("returns bars oldest first, dated at UTC midnight", () => {
    const bars = mapPriceBars(parse(timeSeriesSchema, AAPL_TIME_SERIES));
    expect(bars.map((b) => b.date.toISOString())).toEqual([
      "2026-09-15T00:00:00.000Z",
      "2026-09-16T00:00:00.000Z",
    ]);
    expect(bars[1]!.close.toDecimal().toFixed()).toBe("332.695");
    expect(bars[1]!.volume.toFixed()).toBe("466780");
    expect(bars[0]!.close.currency).toBe("USD");
  });
});

describe("mapDividends", () => {
  it("carries the ex-date and amount, leaving the dates Twelve Data does not send null", () => {
    const divs = mapDividends(parse(dividendsSchema, AAPL_DIVIDENDS), "AAPL");
    expect(divs).toHaveLength(2);
    expect(divs[0]).toMatchObject({
      symbol: "AAPL",
      exDividendDate: new Date("2026-08-10T00:00:00Z"),
      paymentDate: null,
      announcedDate: null,
      recordDate: null,
      period: null,
    });
    expect(divs[0]!.amountPerShare.toDecimal().toFixed()).toBe("0.27");
    expect(divs[0]!.amountPerShare.currency).toBe("USD");
  });
});

describe("mapAssetProfile", () => {
  it("takes identity from /profile and currency and the 52-week range from /quote", () => {
    const p = mapAssetProfile(
      parse(profileSchema, AAPL_PROFILE),
      parse(quoteSchema, AAPL_QUOTE),
      "AAPL",
    );
    expect(p).toMatchObject({
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "NASDAQ",
      currency: "USD",
      assetType: "stock",
      sector: "Technology",
      industry: "Consumer Electronics",
      website: "https://www.apple.com",
      ceo: "Mr. John Ternus",
      fullTimeEmployees: "150000",
      country: "United States",
      countryIso: "US",
      marketCap: null,
      peRatio: null,
      beta: null,
      dividendYield: null,
      payoutRatio: null,
      trailingAnnualDividend: null,
      ipoDate: null,
      fund: null,
    });
    expect(p.fiftyTwoWeekHigh?.toDecimal().toFixed()).toBe("344.57001");
    expect(p.fiftyTwoWeekLow?.toDecimal().toFixed()).toBe("236.32001");
  });

  it("reads an ETF as an etf, and an absent field as null rather than an empty string", () => {
    const p = mapAssetProfile(
      parse(profileSchema, {
        symbol: "VOO",
        name: "Vanguard S&P 500 ETF",
        exchange: "NYSE",
        type: "ETF",
        sector: "",
        country: "",
      }),
      parse(quoteSchema, VOO_QUOTE),
      "VOO",
    );
    expect(p.assetType).toBe("etf");
    expect(p.sector).toBeNull();
    expect(p.country).toBeNull();
    expect(p.countryIso).toBeNull();
  });
});

describe("mapSearchResults", () => {
  it("maps listings back to Sage symbols and drops venues Sage cannot price", () => {
    const results = mapSearchResults(parse(searchSchema, SEARCH_RESULTS));
    expect(results).toEqual([
      {
        symbol: "NORDLAS-B.ST",
        name: "Nordlas AB",
        exchange: "OMX",
        currency: "SEK",
        assetType: "stock",
      },
      {
        symbol: "THAMES.L",
        name: "Thames Holdings plc",
        exchange: "LSE",
        currency: "GBP",
        assetType: "stock",
      },
      {
        symbol: "VOO",
        name: "Vanguard S&P 500 ETF",
        exchange: "NYSE",
        currency: "USD",
        assetType: "etf",
      },
    ]);
  });
});

describe("mapAssetType", () => {
  it.each([
    ["Common Stock", "stock"],
    ["REIT", "stock"],
    ["Preferred Stock", "stock"],
    ["American Depositary Receipt", "stock"],
    ["Depositary Receipt", "stock"],
    ["ETF", "etf"],
    ["Mutual Fund", "fund"],
    ["Closed-end Fund", "fund"],
    ["Warrant", "other"],
    [undefined, "other"],
  ])("maps %s to %s", (type, expected) => {
    expect(mapAssetType(type)).toBe(expected);
  });
});

describe("parse", () => {
  it("turns an unexpected shape into ProviderUnavailableError", () => {
    expect(() => parse(quoteSchema, { nonsense: true })).toThrow(ProviderUnavailableError);
  });
});
