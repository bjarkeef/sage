import { it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { Money } from "@sage/core";
import type { IAnalystRatingsProvider, AnalystRatings } from "@sage/provider-interface";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { instrument, analystRatingsCache } from "../db/schema";
import { getSymbolRatings, toStoredRatings } from "./ratings-view";

/** Fake IAnalystRatingsProvider that counts calls per symbol so tests can
 *  assert the cache short-circuits repeat fetches (including no-coverage). */
class FakeAnalystRatingsProvider implements IAnalystRatingsProvider {
  calls: Record<string, number> = {};

  constructor(private ratingsBySymbol: Record<string, AnalystRatings | null>) {}

  getAnalystRatings(symbol: string): Promise<AnalystRatings | null> {
    this.calls[symbol] = (this.calls[symbol] ?? 0) + 1;
    return Promise.resolve(this.ratingsBySymbol[symbol] ?? null);
  }
}

function fakeRatings(): AnalystRatings {
  return {
    consensusKey: "buy",
    distribution: { strongBuy: 5, buy: 10, hold: 3, sell: 1, strongSell: 0 },
    targets: {
      low: Money.of("50", "USD"),
      mean: Money.of("65", "USD"),
      high: Money.of("80", "USD"),
      median: Money.of("64", "USD"),
    },
    currentPrice: Money.of("60", "USD"),
    analystCount: 19,
    asOf: new Date("2026-07-20T00:00:00Z"),
    upgradeHistory: [
      {
        firm: "Fake Bank",
        fromGrade: "Hold",
        toGrade: "Buy",
        action: "up",
        date: new Date("2026-07-15T00:00:00Z"),
      },
    ],
  };
}

describeDb("ratings-view", () => {
  let tdb: TestDb;

  beforeAll(async () => {
    tdb = await withTestDb();

    await tdb.db.insert(instrument).values([
      { symbol: "KO", name: "Coca-Cola", exchange: "XNYS", currency: "USD", assetType: "stock" },
      {
        symbol: "NOCOV",
        name: "No Coverage Corp",
        exchange: "XNYS",
        currency: "USD",
        assetType: "stock",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("cold-fetches a covered symbol from the provider, stores it, and returns it", async () => {
    const ratings = fakeRatings();
    const provider = new FakeAnalystRatingsProvider({ KO: ratings });

    const out = await getSymbolRatings(tdb.db, provider, "KO");

    expect(out).toEqual(toStoredRatings(ratings));
    expect(provider.calls.KO).toBe(1);

    const [row] = await tdb.db
      .select()
      .from(analystRatingsCache)
      .where(eq(analystRatingsCache.symbol, "KO"));
    expect(row).toBeTruthy();
    expect(row!.data).toEqual(toStoredRatings(ratings));
  });

  it("serves the cached row on a second call without calling the provider again", async () => {
    const provider = new FakeAnalystRatingsProvider({
      KO: { ...fakeRatings(), consensusKey: "strongBuy" }, // would prove a re-fetch happened if returned
    });

    const out = await getSymbolRatings(tdb.db, provider, "KO");

    expect(out?.consensusKey).toBe("buy"); // still the row stored by the cold fetch
    expect(provider.calls.KO).toBeUndefined(); // never called on this provider instance
  });

  it("stores a data=null row when the provider reports no coverage, and memoizes it", async () => {
    const provider = new FakeAnalystRatingsProvider({ NOCOV: null });

    const out = await getSymbolRatings(tdb.db, provider, "NOCOV");

    expect(out).toBeNull();
    expect(provider.calls.NOCOV).toBe(1);

    const [row] = await tdb.db
      .select()
      .from(analystRatingsCache)
      .where(eq(analystRatingsCache.symbol, "NOCOV"));
    expect(row).toBeTruthy();
    expect(row!.data).toBeNull();
  });

  it("returns null from the memoized no-coverage row without re-calling the provider", async () => {
    const provider = new FakeAnalystRatingsProvider({
      NOCOV: fakeRatings(), // would prove a re-fetch happened if returned
    });

    const out = await getSymbolRatings(tdb.db, provider, "NOCOV");

    expect(out).toBeNull();
    expect(provider.calls.NOCOV).toBeUndefined(); // never called on this provider instance
  });
});
