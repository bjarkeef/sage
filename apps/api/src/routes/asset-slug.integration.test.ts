import { it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { Money } from "@sage/core";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { user, portfolio, instrument } from "../db/schema";
import { assetRoutes } from "./asset";
import type { AppEnv } from "../middleware/session";

/**
 * `/asset/:slug` accepts both `SYMBOL` and `EXCHANGE-SYMBOL` — `holding-row.tsx`
 * emits the prefixed form while the dividend list, the calendar and the
 * category browser all link the bare symbol. The route split on the FIRST dash
 * to strip that prefix, which silently mangles any symbol that contains a dash
 * of its own: a Nordic share class collapsed to just its share-class segment
 * and 404'd from every one of those links.
 */
describeDb("GET /:slug — slug resolution", () => {
  let tdb: TestDb;
  let app: Hono<AppEnv>;

  beforeAll(async () => {
    tdb = await withTestDb();

    const userId = "asset-slug-user";
    await tdb.db.insert(user).values({
      id: userId,
      name: "Asset Slug User",
      email: "asset-slug@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await tdb.db.insert(portfolio).values({ userId, name: "Default" });

    await tdb.db.insert(instrument).values([
      {
        symbol: "NORDLAS-B.ST",
        name: "Nordlas B",
        exchange: "STO",
        currency: "SEK",
        assetType: "stock",
      },
      { symbol: "MSFT", name: "Microsoft", exchange: "XNAS", currency: "USD", assetType: "stock" },
    ]);

    const provider = new FakeMarketDataProvider({
      quotes: {
        "NORDLAS-B.ST": {
          symbol: "NORDLAS-B.ST",
          price: Money.of("250.00", "SEK"),
          asOf: new Date(),
          previousClose: null,
        },
        MSFT: {
          symbol: "MSFT",
          price: Money.of("400.00", "USD"),
          asOf: new Date(),
          previousClose: null,
        },
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

  it("keeps a symbol whose own name contains a dash", async () => {
    const res = await app.request(`/${encodeURIComponent("NORDLAS-B.ST")}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { symbol: string } };
    // The leading segment is part of the symbol, not an exchange prefix.
    expect(body.profile.symbol).toBe("NORDLAS-B.ST");
  });

  it("still strips a genuine exchange prefix", async () => {
    const res = await app.request("/XNAS-MSFT");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { symbol: string } };
    expect(body.profile.symbol).toBe("MSFT");
  });
});
