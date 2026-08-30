import { it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { AssetProfile } from "@sage/provider-interface";
import { eq } from "drizzle-orm";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { user, portfolio, instrument } from "../db/schema";
import { assetRoutes } from "./asset";
import type { AppEnv } from "../middleware/session";

/**
 * A CSV without a name column imports every row with the ticker as the
 * instrument's name — `parseGenericCsv` has nothing better to use. Fetching the
 * asset profile is what learns the real name, but the instrument upsert on that
 * path was `onConflictDoNothing`, so for an already-imported symbol the real
 * name was fetched, written to `asset_profile`, and then thrown away. Holdings
 * lists showed "ABBV / ABBV" permanently.
 *
 * Mounts the real route on a throwaway Hono with a stub session, the same
 * precedent asset-income.integration.test.ts documents at length.
 */
function profileFor(symbol: string, name: string): AssetProfile {
  return {
    symbol,
    name,
    exchange: "XNYS",
    currency: "USD",
    assetType: "stock",
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
  };
}

describeDb("GET /:slug — instrument name backfill", () => {
  let tdb: TestDb;
  let app: Hono<AppEnv>;

  beforeAll(async () => {
    tdb = await withTestDb();

    const userId = "instrument-name-user";
    await tdb.db.insert(user).values({
      id: userId,
      name: "Instrument Name User",
      email: "instrument-name@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await tdb.db.insert(portfolio).values({ userId, name: "Default" });

    await tdb.db.insert(instrument).values([
      // Imported from a CSV with no name column: the name IS the ticker.
      { symbol: "KO", name: "KO", exchange: "XNYS", currency: "USD", assetType: "stock" },
      // Already carries a real name — must not be overwritten by the provider.
      { symbol: "O", name: "Realty Income", exchange: "XNYS", currency: "USD", assetType: "stock" },
    ]);

    const provider = new FakeMarketDataProvider({
      profiles: {
        KO: profileFor("KO", "The Coca-Cola Company"),
        O: profileFor("O", "Realty Income Corporation"),
      },
    });

    app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("user", { id: userId });
      c.set("session", {});
      await next();
    });
    app.route("/", assetRoutes(tdb.db, provider));
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("upgrades a placeholder instrument name to the provider's real one", async () => {
    await app.request("/KO");

    const [row] = await tdb.db
      .select({ name: instrument.name })
      .from(instrument)
      .where(eq(instrument.symbol, "KO"));
    expect(row?.name).toBe("The Coca-Cola Company");
  });

  it("leaves an instrument that already has a real name alone", async () => {
    // Only a name equal to the symbol is treated as a placeholder. Anything
    // else may have been set deliberately, and the provider does not get to
    // overwrite it.
    await app.request("/O");

    const [row] = await tdb.db
      .select({ name: instrument.name })
      .from(instrument)
      .where(eq(instrument.symbol, "O"));
    expect(row?.name).toBe("Realty Income");
  });
});
