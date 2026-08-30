import { it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { AssetProfile } from "@sage/provider-interface";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { instrument, assetProfile } from "../db/schema";
import { backfillProfiles } from "./asset-profile-cache";

function profileOf(symbol: string, name: string, sector: string, country: string): AssetProfile {
  return {
    symbol,
    name,
    exchange: "NMS",
    currency: "USD",
    assetType: "stock",
    sector,
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
    country,
    countryIso: null,
    fund: null,
  };
}

/**
 * These exist because of a first-run walkthrough: an imported book showed
 * `Unknown` for sector, country and region on Diversification, and `MSFT / MSFT`
 * in the holdings list, because the only thing that ever wrote `asset_profile`
 * was someone opening an asset page. The importer now backfills, and these pin
 * the two properties that fix depends on — that it writes the table, and that
 * one dead symbol cannot strand the rest of a book.
 */
describeDb("backfillProfiles", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await withTestDb();
  });
  afterAll(async () => {
    await t.stop();
  });

  it("writes sector and country for a symbol that had no profile", async () => {
    const provider = new FakeMarketDataProvider({
      profiles: { MSFT: profileOf("MSFT", "Microsoft Corporation", "Technology", "United States") },
    });

    const result = await backfillProfiles(t.db, provider, ["MSFT"]);

    expect(result).toEqual({ fetched: 1, failed: 0 });
    const [row] = await t.db.select().from(assetProfile).where(eq(assetProfile.symbol, "MSFT"));
    expect(row?.sector).toBe("Technology");
    expect(row?.country).toBe("United States");
  });

  /** A CSV with no name column imports every row with the ticker as its name.
   *  The backfill is the only thing that ever learns better. */
  it("upgrades an instrument whose name is still the ticker", async () => {
    await t.db.insert(instrument).values({
      symbol: "KO",
      name: "KO",
      exchange: "UNKNOWN",
      currency: "USD",
      assetType: "stock",
    });
    const provider = new FakeMarketDataProvider({
      profiles: {
        KO: profileOf("KO", "The Coca-Cola Company", "Consumer Defensive", "United States"),
      },
    });

    await backfillProfiles(t.db, provider, ["KO"]);

    const [row] = await t.db.select().from(instrument).where(eq(instrument.symbol, "KO"));
    expect(row?.name).toBe("The Coca-Cola Company");
  });

  /** Never for a value, always for the side effect: a provider that 404s one
   *  ticker must not cost the import the other forty-nine. */
  it("keeps going when a symbol has no profile, and counts it", async () => {
    const provider = new FakeMarketDataProvider({
      profiles: { AAPL: profileOf("AAPL", "Apple Inc.", "Technology", "United States") },
    });

    const result = await backfillProfiles(t.db, provider, ["DELISTED", "AAPL"]);

    expect(result).toEqual({ fetched: 1, failed: 1 });
    const [row] = await t.db.select().from(assetProfile).where(eq(assetProfile.symbol, "AAPL"));
    expect(row?.sector).toBe("Technology");
  });
});
