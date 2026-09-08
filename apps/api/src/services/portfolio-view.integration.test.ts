import { it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { Decimal, Money } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { Quote, IFxRateService } from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { user, assetProfile } from "../db/schema";
import { buildPortfolioView } from "./portfolio-view";

const aapl = {
  symbol: "AAPL",
  name: "Apple Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};
const msft = {
  symbol: "MSFT",
  name: "Microsoft Corp",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};
const nvda = {
  symbol: "NVDA",
  name: "NVIDIA Corp",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};
const tsla = {
  symbol: "TSLA",
  name: "Tesla Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};
const globix = {
  symbol: "GLOBIX.XLON",
  name: "Globix All-World",
  exchange: "XLON",
  currency: "GBP",
  assetType: "etf",
};
// The importer had nothing better and wrote the ticker in as the name -- the
// measured, real-world shape `resolveDisplayName` exists to fix.
const duomo = {
  symbol: "DUOMO.MI",
  name: "DUOMO",
  exchange: "XMIL",
  currency: "EUR",
  assetType: "stock",
};
const acme = {
  symbol: "ACME",
  name: "ACME",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};

function quote(symbol: string, price: string, ccy: string, previousClose: string | null): Quote {
  return {
    symbol,
    price: Money.of(price, ccy),
    asOf: new Date("2026-06-19"),
    previousClose: previousClose ? Money.of(previousClose, ccy) : null,
  };
}

async function post(app: ReturnType<typeof createApp>, body: unknown, cookie: string) {
  return app.request("/transactions", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describeDb("buildPortfolioView — portfolio-level todayChange", () => {
  let tdb: TestDb;
  let cookie: string;
  let userId: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    tdb = await withTestDb();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, new FakeMarketDataProvider(), auth);
    cookie = await signUpTestUser(app, "today-change@example.com");
    const [row] = await tdb.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "today-change@example.com"))
      .limit(1);
    if (!row) throw new Error("test user not found after sign-up");
    userId = row.id;
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("aggregates today change across two same-currency positions", async () => {
    const provider = new FakeMarketDataProvider({
      quotes: {
        AAPL: quote("AAPL", "150", "USD", "148"),
        MSFT: quote("MSFT", "110", "USD", "100"),
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);

    await post(
      app,
      { instrument: aapl, type: "buy", quantity: "10", price: "100", tradeDate: "2026-01-01" },
      cookie,
    );
    await post(
      app,
      { instrument: msft, type: "buy", quantity: "5", price: "200", tradeDate: "2026-01-02" },
      cookie,
    );

    const { todayChange } = await buildPortfolioView({ db: tdb.db, provider }, userId, {
      currency: null,
    });

    // AAPL: (150-148)*10 = 20; MSFT: (110-100)*5 = 50 -> sum 70.
    // marketValue: 1500 + 550 = 2050; denominator 2050-70=1980; 70/1980*100 = 3.5354 -> 3.54.
    expect(todayChange).toEqual({ amount: { amount: "70.00", currency: "USD" }, percent: 3.54 });
  });

  it("is null when no held position has a previousClose", async () => {
    // Provider only quotes NVDA (no previousClose); AAPL/MSFT quotes reject, contributing nothing.
    const provider = new FakeMarketDataProvider({
      quotes: { NVDA: quote("NVDA", "150", "USD", null) },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);

    await post(
      app,
      { instrument: nvda, type: "buy", quantity: "10", price: "100", tradeDate: "2026-01-03" },
      cookie,
    );

    const { todayChange } = await buildPortfolioView({ db: tdb.db, provider }, userId, {
      currency: null,
    });

    expect(todayChange).toBeNull();
  });

  it("reports the ledger's own currency separately from the display currency", async () => {
    // The bug this guards: `currency` is the DISPLAY currency, so a USD-ledger
    // position viewed in DKK reports "DKK". A caller that treats it as the
    // transaction currency -- the holdings-row quick-add did -- posts a DKK
    // transaction against a USD ledger and the API refuses it as a
    // currency_mismatch. `nativeCurrency` is what that caller needs.
    const provider = new FakeMarketDataProvider({
      quotes: { NVDA: quote("NVDA", "150", "USD", "148") },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);

    const fxRateService: IFxRateService = {
      getRate: () => Promise.reject(new Error("not used by this test")),
      // Rates are quoted per target unit: 1 DKK = 0.15 USD.
      getRates: () => Promise.resolve(new Map([["USD", new Decimal("0.15")]])),
    };

    await post(
      app,
      { instrument: nvda, type: "buy", quantity: "2", price: "100", tradeDate: "2026-01-06" },
      cookie,
    );

    const { body } = await buildPortfolioView({ db: tdb.db, provider, fxRateService }, userId, {
      currency: "DKK",
    });

    const held = body.positions.find((p) => p.symbol === "NVDA");
    expect(held?.currency).toBe("DKK");
    expect(held?.nativeCurrency).toBe("USD");
  });

  it("is null for mixed-currency positions with no FX rates (native mode)", async () => {
    // Two priced positions in different native currencies, no fxRateService -> native mode.
    // Both contribute a dailyChange, but in different currencies, so the aggregate can't unify.
    const provider = new FakeMarketDataProvider({
      quotes: {
        TSLA: quote("TSLA", "220", "USD", "200"),
        "GLOBIX.XLON": quote("GLOBIX.XLON", "105", "GBP", "100"),
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);

    await post(
      app,
      { instrument: tsla, type: "buy", quantity: "1", price: "200", tradeDate: "2026-01-04" },
      cookie,
    );
    await post(
      app,
      { instrument: globix, type: "buy", quantity: "1", price: "90", tradeDate: "2026-01-05" },
      cookie,
    );

    const { todayChange } = await buildPortfolioView({ db: tdb.db, provider }, userId, {
      currency: null,
    });

    expect(todayChange).toBeNull();
  });

  it("prefers the cached profile name over an echoing instrument name", async () => {
    // instrument.name = "DUOMO" (the importer's echo); asset_profile.name real.
    const provider = new FakeMarketDataProvider({
      quotes: { "DUOMO.MI": quote("DUOMO.MI", "50", "EUR", "49") },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);

    await post(
      app,
      { instrument: duomo, type: "buy", quantity: "3", price: "45", tradeDate: "2026-01-07" },
      cookie,
    );
    await tdb.db.insert(assetProfile).values({
      symbol: "DUOMO.MI",
      name: "Duomo Industrials SpA",
      exchange: "XMIL",
      currency: "EUR",
    });

    const { body } = await buildPortfolioView({ db: tdb.db, provider }, userId, {
      currency: null,
    });

    const pos = body.positions.find((p) => p.symbol === "DUOMO.MI");
    expect(pos?.name).toBe("Duomo Industrials SpA");
  });

  it("falls back to the symbol when no source carries a real name", async () => {
    // instrument.name = "ACME" (echo) and no cached asset_profile row at all.
    const provider = new FakeMarketDataProvider({
      quotes: { ACME: quote("ACME", "10", "USD", "9") },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);

    await post(
      app,
      { instrument: acme, type: "buy", quantity: "4", price: "8", tradeDate: "2026-01-08" },
      cookie,
    );

    const { body } = await buildPortfolioView({ db: tdb.db, provider }, userId, {
      currency: null,
    });

    const pos = body.positions.find((p) => p.symbol === "ACME");
    expect(pos?.name).toBe("ACME");
  });
});
