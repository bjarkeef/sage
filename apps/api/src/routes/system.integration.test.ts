import { it, expect, beforeAll, afterAll } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { Money, Decimal } from "@sage/core";
import type { Quote, IFxRateService } from "@sage/provider-interface";
import { ProviderRateLimitError } from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { instrument, transaction, user, portfolio, fxRateDaily, manualPrice } from "../db/schema";
import type { SystemBody, SystemInfo } from "./system";
import { ProviderHealthRegistry } from "../market-data/provider-health";
import { PriceStore } from "../market-data/price-store";
import { eq, sql } from "drizzle-orm";

const EODHD_SECRET = "super-secret-eodhd-token";

const SYSTEM_INFO: SystemInfo = {
  nodeEnv: "test",
  signupsOpen: true,
  marketData: "yahoo",
  enrichment: "none",
  keys: { eodhd: true },
};

function quote(symbol: string, price: string, ccy: string): Quote {
  return { symbol, price: Money.of(price, ccy), asOf: new Date("2026-07-24"), previousClose: null };
}

/** FX with nothing stored for the requested pairs — they come back unpriced,
 *  which is how the ECB service reports a currency it has no row for. */
const emptyFx: IFxRateService = {
  getRate: () => Promise.reject(new Error("FX rate unavailable")),
  getRates: () => Promise.resolve(new Map()),
};

/** FX that prices every requested pair. */
const liveFx: IFxRateService = {
  getRate: () => Promise.resolve(new Decimal("0.16")),
  getRates: (_base, targets) =>
    Promise.resolve(new Map(targets.map((t) => [t, new Decimal("0.16")]))),
};

describeDb("GET /system/fx", () => {
  let tdb: TestDb;
  let userId: string;
  let cookie: string;

  const provider = new FakeMarketDataProvider({
    quotes: { AAPL: quote("AAPL", "160", "USD") },
  });

  function appWith(fx: IFxRateService, info: SystemInfo = SYSTEM_INFO) {
    return createApp(tdb.db, provider, createAuth(tdb.db, testEnv), undefined, fx, undefined, {
      systemInfo: info,
    });
  }

  async function fetchSystem(fx: IFxRateService, info?: SystemInfo): Promise<SystemBody> {
    const res = await appWith(fx, info).request("/system", { headers: { cookie } });
    expect(res.status).toBe(200);
    return (await res.json()) as SystemBody;
  }

  async function fetchStatus(fx: IFxRateService): Promise<SystemBody["fx"]> {
    return (await fetchSystem(fx)).fx;
  }

  beforeAll(async () => {
    tdb = await withTestDb();
    const app = appWith(liveFx);
    cookie = await signUpTestUser(app, "sys-fx@example.com");
    const [u] = await tdb.db.select().from(user).limit(1);
    userId = u!.id;

    await tdb.db.insert(instrument).values({
      symbol: "AAPL",
      name: "Apple Inc",
      exchange: "XNAS",
      currency: "USD",
      assetType: "stock",
    });
    const [p] = await tdb.db.select().from(portfolio).limit(1);
    await tdb.db.insert(transaction).values({
      portfolioId: p!.id,
      instrumentSymbol: "AAPL",
      type: "buy",
      quantity: "10",
      price: "150",
      currency: "USD",
      tradeDate: "2026-01-02",
    });
  });

  afterAll(async () => {
    await tdb?.stop();
  });

  async function setDisplayCurrency(ccy: string | null) {
    await tdb.db.update(user).set({ displayCurrency: ccy }).where(eq(user.id, userId));
  }

  it("reports nothing to convert when no display currency is set", async () => {
    await setDisplayCurrency(null);
    const body = await fetchStatus(liveFx);
    expect(body.displayCurrency).toBeNull();
    expect(body.pairs).toEqual([]);
  });

  it("reports the ECB source and the publication day behind it", async () => {
    await setDisplayCurrency("DKK");
    // 0.16 USD per DKK, tagged with the publication day the service served.
    const datedFx = { ...liveFx, latestDate: () => Promise.resolve("2026-08-07") };
    const body = await fetchStatus(datedFx);
    expect(body.ratesAsOf).toBe("2026-08-07");
    const usd = body.pairs.find((p) => p.from === "USD");
    expect(usd).toMatchObject({ from: "USD", to: "DKK", source: "ecb" });
    // Oriented for reading: units of the DISPLAY currency per 1 foreign unit.
    expect(usd!.rate).toBe("6.25");
  });

  it("reports the runtime environment", async () => {
    const body = await fetchSystem(liveFx);
    expect(body.environment.nodeEnv).toBe("test");
    expect(body.environment.nodeVersion).toBe(process.version);
    expect(body.environment.signups).toBe("open");
    expect(body.environment.uptimeSeconds).toBeGreaterThan(0);
  });

  it("counts the applied schema migrations", async () => {
    const body = await fetchSystem(liveFx);
    // The template database this clone came from was migrated, so the journal
    // must have entries.
    expect(body.environment.schemaMigrations).toBeGreaterThan(0);
  });

  it("reports schemaMigrations as null when the migrations table is absent", async () => {
    await tdb.db.execute(sql`drop table if exists drizzle."__drizzle_migrations"`);
    const body = await fetchSystem(liveFx);
    expect(body.environment.schemaMigrations).toBeNull();
    // Everything else still resolves — a missing internal table is not fatal.
    expect(body.providers.marketData).toBe("yahoo");
  });

  it("reports providers and which keys are configured, never their values", async () => {
    const body = await fetchSystem(liveFx);
    expect(body.providers).toEqual({
      marketData: "yahoo",
      enrichment: "none",
      keys: { eodhd: true },
      health: [],
      pricesAgeSeconds: null,
      pricesStale: false,
      pricesMissing: 1,
    });
  });

  it("never serialises an API key value", async () => {
    // The route is handed booleans, not secrets — this guards that contract
    // against someone later passing Env straight through.
    const res = await appWith(liveFx).request("/system", { headers: { cookie } });
    const raw = await res.text();
    expect(raw).not.toContain(EODHD_SECRET);
  });

  it("reports a currency nothing can price as unavailable", async () => {
    await setDisplayCurrency("DKK");
    const body = await fetchStatus(emptyFx);
    const usd = body.pairs.find((p) => p.from === "USD");
    expect(usd!.source).toBe("unavailable");
    expect(usd!.rate).toBeNull();
  });

  it("reports the earliest publication day stored in fx_rate_daily as coverageFrom", async () => {
    await tdb.db.delete(fxRateDaily);
    await tdb.db.insert(fxRateDaily).values([
      { date: "2026-01-05", currency: "USD", rate: "1.05" },
      { date: "2026-06-01", currency: "USD", rate: "1.10" },
    ]);
    const body = await fetchStatus(liveFx);
    expect(body.coverageFrom).toBe("2026-01-05");
  });

  it("reports coverageFrom as null when fx_rate_daily is empty", async () => {
    await tdb.db.delete(fxRateDaily);
    const body = await fetchStatus(liveFx);
    expect(body.coverageFrom).toBeNull();
  });
});

/**
 * I2: `buildPriceAge` had no test at all — replacing its body with a constant
 * left every one of the 492 tests green, while the spec's own Testing section
 * requires `/system` to report `pricesStale` and a plausible age when stored
 * fetches are old, and fresh when recent.
 */
describeDb("GET /system price age", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  /** Holds AAPL. */
  let holderCookie: string;
  /** Holds MSFT only — used to prove a stale AAPL row cannot warn them. */
  let otherCookie: string;
  let store: PriceStore;

  const provider = new FakeMarketDataProvider({
    quotes: { AAPL: quote("AAPL", "160", "USD") },
  });

  /** Stores a quote for `symbol` whose successful fetch happened `secondsAgo`. */
  async function storeFetchedAt(symbol: string, secondsAgo: number) {
    await store.writeQuote(
      {
        symbol,
        price: Money.of("160", "USD"),
        // Relative to now, never a hardcoded date: a fixture date would rot.
        asOf: new Date(Date.now() - secondsAgo * 1000),
        previousClose: null,
      },
      new Date(Date.now() - secondsAgo * 1000),
    );
  }

  async function priceStatus(cookie: string) {
    const res = await app.request("/system", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SystemBody;
    return body.providers;
  }

  async function buy(cookie: string, email: string, symbol: string) {
    const [u] = await tdb.db.select().from(user).where(eq(user.email, email));
    const [pf] = await tdb.db.select().from(portfolio).where(eq(portfolio.userId, u!.id));
    await tdb.db.insert(transaction).values({
      portfolioId: pf!.id,
      instrumentSymbol: symbol,
      type: "buy",
      quantity: "10",
      price: "100",
      currency: "USD",
      tradeDate: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
    });
    return cookie;
  }

  beforeAll(async () => {
    tdb = await withTestDb();
    store = new PriceStore(tdb.db);
    app = createApp(tdb.db, provider, createAuth(tdb.db, testEnv), undefined, liveFx, undefined, {
      systemInfo: SYSTEM_INFO,
    });

    await tdb.db.insert(instrument).values([
      { symbol: "AAPL", name: "Apple", exchange: "XNAS", currency: "USD", assetType: "stock" },
      { symbol: "MSFT", name: "Microsoft", exchange: "XNAS", currency: "USD", assetType: "stock" },
    ]);

    holderCookie = await signUpTestUser(app, "price-age-holder@example.com");
    await buy(holderCookie, "price-age-holder@example.com", "AAPL");
    otherCookie = await signUpTestUser(app, "price-age-other@example.com");
    await buy(otherCookie, "price-age-other@example.com", "MSFT");
  });

  afterAll(async () => await tdb.stop());

  it("flags stale prices with a plausible age when the stored fetch is old", async () => {
    const threeDays = 3 * 86_400;
    await storeFetchedAt("AAPL", threeDays);

    const providers = await priceStatus(holderCookie);

    expect(providers.pricesStale).toBe(true);
    // Plausible, not exact: the row was written moments ago at a computed
    // offset, so allow a minute of slack for the round trip.
    expect(providers.pricesAgeSeconds).toBeGreaterThan(threeDays - 60);
    expect(providers.pricesAgeSeconds).toBeLessThan(threeDays + 60);
    expect(providers.pricesMissing).toBe(0);
  });

  it("reports a recent fetch as fresh", async () => {
    await storeFetchedAt("AAPL", 120);

    const providers = await priceStatus(holderCookie);

    expect(providers.pricesStale).toBe(false);
    expect(providers.pricesAgeSeconds).toBeGreaterThanOrEqual(0);
    expect(providers.pricesAgeSeconds).toBeLessThan(600);
  });

  // The scoping rule: prices are shared instance-wide, so without it one user's
  // untouched symbol would warn everybody.
  it("ignores a stale row for a symbol the caller does not hold", async () => {
    await storeFetchedAt("AAPL", 10 * 86_400);
    await storeFetchedAt("MSFT", 120);

    const providers = await priceStatus(otherCookie);

    expect(providers.pricesStale).toBe(false);
    expect(providers.pricesAgeSeconds).toBeLessThan(600);
    expect(providers.pricesMissing).toBe(0);
  });

  // I3: a fresh instance whose first fetch lands during an outage stores
  // nothing. Not stale — there is no age to be old — but nothing is priceable,
  // and this count is what lets the UI say so instead of going silent.
  it("counts held symbols with no stored quote at all", async () => {
    const cookie = await signUpTestUser(app, "price-age-empty@example.com");
    await tdb.db.insert(instrument).values({
      symbol: "NOPRICE",
      name: "Unpriced",
      exchange: "XNAS",
      currency: "USD",
      assetType: "stock",
    });
    await buy(cookie, "price-age-empty@example.com", "NOPRICE");

    const providers = await priceStatus(cookie);

    expect(providers.pricesMissing).toBe(1);
    expect(providers.pricesStale).toBe(false);
    expect(providers.pricesAgeSeconds).toBeNull();
  });

  // A custom instrument is priced by ManualPriceProvider out of `manual_price`.
  // CustomRoutingProvider sits OUTSIDE Caching → PersistedPriceProvider and
  // routes it there authoritatively, so it never reaches `price_quote` by
  // design. Counting it as missing lit the instance-wide callout permanently on
  // a perfectly healthy instance for anyone using savings/pension tracking —
  // and a warning that is always on trains the reader to ignore the real one.
  it("does not count a manually-priced custom holding as missing", async () => {
    const cookie = await signUpTestUser(app, "price-age-custom@example.com");
    await tdb.db.insert(instrument).values([
      {
        symbol: "MYPENSION",
        name: "Pension",
        exchange: "CUSTOM",
        currency: "USD",
        assetType: "custom",
      },
      { symbol: "TSLA", name: "Tesla", exchange: "XNAS", currency: "USD", assetType: "stock" },
    ]);
    await tdb.db.insert(manualPrice).values({
      symbol: "MYPENSION",
      date: new Date().toISOString().slice(0, 10),
      price: "50000",
      currency: "USD",
    });
    await buy(cookie, "price-age-custom@example.com", "MYPENSION");
    await buy(cookie, "price-age-custom@example.com", "TSLA");
    // The ordinary holding IS expected in `price_quote`, and has a fresh row.
    await storeFetchedAt("TSLA", 120);

    const providers = await priceStatus(cookie);

    expect(providers.pricesMissing).toBe(0);
    // And the custom holding cannot drag staleness either.
    expect(providers.pricesStale).toBe(false);
    expect(providers.pricesAgeSeconds).toBeLessThan(600);
  });
});

describeDb("GET /system provider health", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  const provider = new FakeMarketDataProvider({
    quotes: { AAPL: quote("AAPL", "100", "USD") },
  });

  beforeAll(async () => {
    tdb = await withTestDb();
    const auth = createAuth(tdb.db, testEnv);
    const registry = new ProviderHealthRegistry();
    registry.register("yahoo");
    registry.recordSuccess("yahoo");
    registry.recordFailure("eodhd", new ProviderRateLimitError());
    registry.register("acme"); // registered but never exercised → "unknown"

    app = createApp(tdb.db, provider, auth, undefined, liveFx, undefined, {
      systemInfo: SYSTEM_INFO,
      providerHealth: registry,
    });
    cookie = await signUpTestUser(app);
  });

  afterAll(async () => await tdb.stop());

  it("reports one row per provider, name-sorted, with reasons", async () => {
    const res = await app.request("/system", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SystemBody;

    expect(body.providers.health.map((h) => h.name)).toEqual(["acme", "eodhd", "yahoo"]);

    const byName = new Map(body.providers.health.map((h) => [h.name, h]));
    expect(byName.get("yahoo")).toMatchObject({ state: "healthy", lastFailureReason: null });
    expect(byName.get("eodhd")).toMatchObject({
      state: "degraded",
      lastFailureReason: "rate-limited",
      consecutiveFailures: 1,
    });
    expect(byName.get("acme")).toMatchObject({
      state: "unknown",
      lastSuccessSecondsAgo: null,
      lastFailureSecondsAgo: null,
    });
  });

  it("sends elapsed seconds, never absolute timestamps", async () => {
    const res = await app.request("/system", { headers: { cookie } });
    const body = (await res.json()) as SystemBody;
    const yahoo = body.providers.health.find((h) => h.name === "yahoo")!;
    // Seconds since this test's own setup — small, and nowhere near an epoch.
    expect(yahoo.lastSuccessSecondsAgo).toBeGreaterThanOrEqual(0);
    expect(yahoo.lastSuccessSecondsAgo).toBeLessThan(600);
  });

  it("reports an empty list when no registry is wired", async () => {
    const auth = createAuth(tdb.db, testEnv);
    const bare = createApp(tdb.db, provider, auth, undefined, liveFx, undefined, {
      systemInfo: SYSTEM_INFO,
    });
    const bareCookie = await signUpTestUser(bare, "sys-health-bare@example.com");
    const res = await bare.request("/system", { headers: { cookie: bareCookie } });
    const body = (await res.json()) as SystemBody;
    expect(body.providers.health).toEqual([]);
  });
});
