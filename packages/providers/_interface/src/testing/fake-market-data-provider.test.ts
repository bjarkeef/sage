import { describe, it, expect } from "vitest";
import { Money, Decimal } from "@sage/core";
import { FakeMarketDataProvider } from "./fake-market-data-provider";
import { SymbolNotFoundError } from "../errors";
import type { Quote, PriceBar, Dividend, SearchResult, AssetProfile } from "../types";

const quote: Quote = {
  symbol: "AAPL",
  price: Money.of("150", "USD"),
  asOf: new Date("2026-01-05"),
  previousClose: Money.of("148", "USD"),
};

const bar = (day: string): PriceBar => ({
  date: new Date(day),
  open: Money.of("1", "USD"),
  high: Money.of("2", "USD"),
  low: Money.of("1", "USD"),
  close: Money.of("1.5", "USD"),
  volume: new Decimal("1000"),
});

const dividend: Dividend = {
  symbol: "AAPL",
  amountPerShare: Money.of("0.24", "USD"),
  exDividendDate: new Date("2026-02-07"),
  paymentDate: new Date("2026-02-14"),
  announcedDate: null,
  recordDate: null,
  period: null,
};

const searchResult: SearchResult = {
  symbol: "AAPL",
  name: "Apple Inc.",
  exchange: "NASDAQ",
  currency: "USD",
  assetType: "stock",
};

describe("FakeMarketDataProvider", () => {
  it("returns a canned quote", async () => {
    const p = new FakeMarketDataProvider({ quotes: { AAPL: quote } });
    expect(await p.getQuote("AAPL")).toBe(quote);
  });

  it("throws SymbolNotFoundError for an unknown quote", async () => {
    const p = new FakeMarketDataProvider();
    await expect(p.getQuote("NOPE")).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it("filters historical prices to the inclusive date range", async () => {
    const p = new FakeMarketDataProvider({
      history: { AAPL: [bar("2026-01-01"), bar("2026-01-05"), bar("2026-01-10")] },
    });
    const bars = await p.getHistoricalPrices(
      "AAPL",
      new Date("2026-01-05"),
      new Date("2026-01-31"),
    );
    expect(bars.map((b) => b.date.toISOString().slice(0, 10))).toEqual([
      "2026-01-05",
      "2026-01-10",
    ]);
  });

  it("returns an empty array for a symbol with no history", async () => {
    const p = new FakeMarketDataProvider();
    expect(await p.getHistoricalPrices("AAPL", new Date(0), new Date())).toEqual([]);
  });

  it("returns canned dividends or an empty array", async () => {
    const p = new FakeMarketDataProvider({ dividends: { AAPL: [dividend] } });
    expect(await p.getDividendHistory("AAPL")).toEqual([dividend]);
    expect(await p.getDividendHistory("MSFT")).toEqual([]);
  });

  it("returns canned search results by exact query or an empty array", async () => {
    const p = new FakeMarketDataProvider({ search: { apple: [searchResult] } });
    expect(await p.searchSymbol("apple")).toEqual([searchResult]);
    expect(await p.searchSymbol("unknown")).toEqual([]);
  });

  it("getAssetProfile returns canned profile", async () => {
    const profile: AssetProfile = {
      symbol: "AAPL",
      name: "Apple Inc",
      exchange: "XNAS",
      currency: "USD" as const,
      assetType: "stock",
      sector: "Technology",
      industry: "Consumer Electronics",
      marketCap: new Decimal("3000000000000"),
      peRatio: new Decimal("30.5"),
      beta: new Decimal("1.2"),
      fiftyTwoWeekHigh: Money.of("200", "USD"),
      fiftyTwoWeekLow: Money.of("150", "USD"),
      dividendYield: new Decimal("0.005"),
      payoutRatio: new Decimal("0.25"),
      trailingAnnualDividend: Money.of("1.00", "USD"),
      website: "https://www.apple.com",
      description: "Apple Inc. designs, manufactures, and markets smartphones.",
      ceo: "Tim Cook",
      fullTimeEmployees: "164000",
      ipoDate: "1980-12-12",
      country: "USA",
      countryIso: "US",
      fund: null,
    };
    const provider = new FakeMarketDataProvider({ profiles: { AAPL: profile } });
    const result = await provider.getAssetProfile("AAPL");
    expect(result.symbol).toBe("AAPL");
    expect(result.sector).toBe("Technology");
  });

  it("getAssetProfile throws SymbolNotFoundError for unknown symbol", async () => {
    const provider = new FakeMarketDataProvider();
    await expect(provider.getAssetProfile("UNKNOWN")).rejects.toThrow(SymbolNotFoundError);
  });
});
