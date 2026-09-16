import { it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { AssetProfile } from "@sage/provider-interface";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { instrument, assetProfile } from "../db/schema";
import {
  backfillProfiles,
  refreshHeldProfiles,
  resetProfileAttemptsForTests,
  PROFILE_REFRESH_MS,
} from "./asset-profile-cache";

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

/** Counts profile fetches, so a test can prove something was NOT fetched. */
function countingProvider(profiles: Record<string, AssetProfile>) {
  const provider = new FakeMarketDataProvider({ profiles });
  const calls: string[] = [];
  const inner = provider.getAssetProfile.bind(provider);
  provider.getAssetProfile = (symbol: string) => {
    calls.push(symbol);
    return inner(symbol);
  };
  return { provider, calls };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A backfill at import time is a single chance. A throttled request, a book
 * imported before backfill existed, or a row written before the country-code
 * fix all stayed wrong for good, because nothing but opening an asset page ever
 * fetched a profile again. On a real book that left 8 of 27 holdings with no
 * profile and most of the rest two months old: a third of it read "Unknown".
 */
describeDb("refreshHeldProfiles", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await withTestDb();
  });
  afterAll(async () => {
    await t.stop();
  });
  beforeEach(() => {
    resetProfileAttemptsForTests();
  });

  it("fetches a held symbol that has no profile", async () => {
    const { provider } = countingProvider({
      NOPROF: profileOf("NOPROF", "No Profile Corp", "Industrials", "Germany"),
    });

    await refreshHeldProfiles(t.db, provider, ["NOPROF"]);

    const [row] = await t.db.select().from(assetProfile).where(eq(assetProfile.symbol, "NOPROF"));
    expect(row?.sector).toBe("Industrials");
  });

  it("re-fetches a profile older than the refresh window", async () => {
    const { provider: seed } = countingProvider({
      OLDROW: profileOf("OLDROW", "Old Row plc", "Energy", "United Kingdom"),
    });
    await backfillProfiles(t.db, seed, ["OLDROW"]);
    await t.db
      .update(assetProfile)
      .set({ countryIso: null, fetchedAt: new Date(Date.now() - PROFILE_REFRESH_MS - DAY_MS) })
      .where(eq(assetProfile.symbol, "OLDROW"));

    const { provider, calls } = countingProvider({
      OLDROW: {
        ...profileOf("OLDROW", "Old Row plc", "Energy", "United Kingdom"),
        countryIso: "GB",
      },
    });
    await refreshHeldProfiles(t.db, provider, ["OLDROW"]);

    expect(calls).toEqual(["OLDROW"]);
    const [row] = await t.db.select().from(assetProfile).where(eq(assetProfile.symbol, "OLDROW"));
    expect(row?.countryIso).toBe("GB");
  });

  it("leaves a recent profile alone", async () => {
    const { provider: seed } = countingProvider({
      FRESHP: profileOf("FRESHP", "Fresh Inc", "Utilities", "United States"),
    });
    await backfillProfiles(t.db, seed, ["FRESHP"]);
    // Older than the 24h read cache, younger than the refresh window: a
    // background pass must not re-fetch a whole book every day.
    await t.db
      .update(assetProfile)
      .set({ fetchedAt: new Date(Date.now() - 2 * DAY_MS) })
      .where(eq(assetProfile.symbol, "FRESHP"));

    const { provider, calls } = countingProvider({
      FRESHP: profileOf("FRESHP", "Fresh Inc", "Utilities", "United States"),
    });
    await refreshHeldProfiles(t.db, provider, ["FRESHP"]);

    expect(calls).toEqual([]);
  });

  /** Every page load calls this. A ticker the provider does not know must not
   *  be asked about on every one of them. */
  it("does not retry a failed symbol straight away", async () => {
    const { provider, calls } = countingProvider({});

    await refreshHeldProfiles(t.db, provider, ["GONE"]);
    await refreshHeldProfiles(t.db, provider, ["GONE"]);

    expect(calls).toEqual(["GONE"]);
  });
});
