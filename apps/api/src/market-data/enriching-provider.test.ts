import { describe, it, expect } from "vitest";
import { Decimal } from "@sage/core";
import type { AssetProfile, FundProfile, IMarketDataProvider } from "@sage/provider-interface";
import { SymbolNotFoundError } from "@sage/provider-interface";
import { EnrichingProvider } from "./enriching-provider";

function makeProfile(overrides: Partial<AssetProfile> = {}): AssetProfile {
  return {
    symbol: "VOO",
    name: "Vanguard S&P 500 ETF",
    exchange: "NYSE",
    currency: "USD",
    assetType: "etf",
    sector: null,
    industry: null,
    marketCap: null,
    peRatio: null,
    beta: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    dividendYield: null,
    payoutRatio: null,
    trailingAnnualDividend: null,
    website: null,
    description: null,
    ceo: null,
    fullTimeEmployees: null,
    ipoDate: null,
    country: null,
    countryIso: null,
    fund: null,
    ...overrides,
  };
}

const FUND: FundProfile = {
  expenseRatio: new Decimal("0.0003"),
  totalAssets: new Decimal("1000000000"),
  family: "Vanguard",
  category: "Large Blend",
  legalType: "Exchange Traded Fund",
  holdings: [{ symbol: "AAPL", name: "Apple Inc", weight: 0.07 }],
  sectorWeightings: [{ sector: "technology", weight: 0.3 }],
};

function providerWith(profile: AssetProfile): IMarketDataProvider {
  return {
    getQuote: (s: string) => Promise.reject(new SymbolNotFoundError(s)),
    getHistoricalPrices: () => Promise.resolve([]),
    getDividendHistory: () => Promise.resolve([]),
    searchSymbol: () => Promise.resolve([]),
    getAssetProfile: () => Promise.resolve(profile),
  };
}

describe("EnrichingProvider.getAssetProfile", () => {
  it("carries the enrichment's fund data onto an ETF profile the primary left without it", async () => {
    const primary = providerWith(makeProfile({ description: null, country: null }));
    const enrichment = providerWith(
      makeProfile({
        fund: FUND,
        description: "Tracks the S&P 500.",
        country: "United States",
        countryIso: "US",
        marketCap: new Decimal("1"),
      }),
    );
    const merged = await new EnrichingProvider(primary, enrichment).getAssetProfile("VOO");
    expect(merged.fund).toBe(FUND);
    expect(merged.description).toBe("Tracks the S&P 500.");
    expect(merged.country).toBe("United States");
    expect(merged.countryIso).toBe("US");
  });

  it("asks the enrichment for fund data even when the primary has every headline figure", async () => {
    const primary = providerWith(
      makeProfile({
        marketCap: new Decimal("1"),
        peRatio: new Decimal("20"),
        beta: new Decimal("1"),
      }),
    );
    const enrichment = providerWith(makeProfile({ fund: FUND }));
    const merged = await new EnrichingProvider(primary, enrichment).getAssetProfile("VOO");
    expect(merged.fund).toBe(FUND);
  });

  it("keeps the primary's values where it has them", async () => {
    const primaryFund: FundProfile = { ...FUND, family: "Primary" };
    const primary = providerWith(
      makeProfile({ fund: primaryFund, description: "Primary text", country: "Ireland" }),
    );
    const enrichment = providerWith(
      makeProfile({ fund: FUND, description: "Enriched text", country: "United States" }),
    );
    const merged = await new EnrichingProvider(primary, enrichment).getAssetProfile("VOO");
    expect(merged.fund).toBe(primaryFund);
    expect(merged.description).toBe("Primary text");
    expect(merged.country).toBe("Ireland");
  });
});
