import { it, expect, beforeAll, afterAll } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { Money, Decimal } from "@sage/core";
import type { Quote, IFxRateService } from "@sage/provider-interface";
import { EcbFxRateService } from "../market-data/ecb-fx-rate-service";
import { STALE_AFTER_DAYS } from "../market-data/fx-provenance";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import {
  portfolio,
  instrument,
  assetProfile,
  customHolding,
  transaction,
  fxRateDaily,
} from "../db/schema";
import type { DiversificationViewBody } from "../services/diversification-view";

function quote(symbol: string, price: string, ccy: string): Quote {
  return { symbol, price: Money.of(price, ccy), asOf: new Date("2026-07-19"), previousClose: null };
}

/**
 * Fixture portfolio (all USD so the base suite is FX-free):
 * - AAPL  stock  10 @ $150 (cost 1500), quote $160  → market 1600
 * - VOO   etf     5 @ $400 (cost 2000), quote $420  → market 2100
 *         sector weights: technology 0.60, financial_services 0.37 (residual 0.03)
 *         top holdings:   AAPL 0.07, MSFT 0.06      (remainder 0.87)
 * - MY_SAVINGS custom 100 @ $10 (cost 1000), quote $10 → market 1000
 *         custom_holding: sector "Banking", country "Denmark"
 */
describeDb("GET /portfolio/diversification", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;
  let portfolioId: string;
  /** Second user holding only NODATA — an etf with NO asset_profile row. */
  let cookie2: string;

  const provider = new FakeMarketDataProvider({
    quotes: {
      AAPL: quote("AAPL", "160", "USD"),
      VOO: quote("VOO", "420", "USD"),
      MY_SAVINGS: quote("MY_SAVINGS", "10", "USD"),
      NODATA: quote("NODATA", "50", "USD"),
    },
  });

  const fxStub: IFxRateService = {
    getRate: () => Promise.resolve(new Decimal("0.5")),
    getRates: (_base, targets) =>
      Promise.resolve(new Map(targets.map((t) => [t, new Decimal("0.5")]))),
  };

  beforeAll(async () => {
    tdb = await withTestDb();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth, undefined, fxStub);
    cookie = await signUpTestUser(app, "div-view@example.com");
    const [p] = await tdb.db.select().from(portfolio).limit(1);
    portfolioId = p!.id;

    await tdb.db.insert(instrument).values([
      { symbol: "AAPL", name: "Apple Inc", exchange: "XNAS", currency: "USD", assetType: "stock" },
      {
        symbol: "VOO",
        name: "Vanguard S&P 500",
        exchange: "XNYS",
        currency: "USD",
        assetType: "etf",
      },
      {
        symbol: "MY_SAVINGS",
        name: "My savings",
        exchange: "CUSTOM",
        currency: "USD",
        assetType: "custom",
      },
    ]);
    await tdb.db.insert(assetProfile).values([
      {
        symbol: "AAPL",
        name: "Apple Inc",
        exchange: "XNAS",
        assetType: "stock",
        currency: "USD",
        sector: "Technology",
        country: "United States",
        countryIso: "US",
        fetchedAt: new Date(),
      },
      {
        symbol: "VOO",
        name: "Vanguard S&P 500",
        exchange: "XNYS",
        assetType: "etf",
        currency: "USD",
        country: "United States",
        countryIso: "US",
        fundSectorWeightings: [
          { sector: "technology", weight: 0.6 },
          { sector: "financial_services", weight: 0.37 },
        ],
        fundHoldings: [
          { name: "Apple Inc", symbol: "AAPL", weight: 0.07 },
          { name: "Microsoft Corp", symbol: "MSFT", weight: 0.06 },
        ],
        fetchedAt: new Date(),
      },
    ]);
    await tdb.db.insert(customHolding).values({
      symbol: "MY_SAVINGS",
      portfolioId,
      holdingType: "savings",
      sector: "Banking",
      country: "Denmark",
    });
    await tdb.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "AAPL",
        type: "buy",
        quantity: "10",
        price: "150",
        currency: "USD",
        tradeDate: "2026-01-02",
      },
      {
        portfolioId,
        instrumentSymbol: "VOO",
        type: "buy",
        quantity: "5",
        price: "400",
        currency: "USD",
        tradeDate: "2026-01-02",
      },
      {
        portfolioId,
        instrumentSymbol: "MY_SAVINGS",
        type: "buy",
        quantity: "100",
        price: "10",
        currency: "USD",
        tradeDate: "2026-01-02",
      },
    ]);

    // Second user: one etf position with no profile row — composition unknown.
    cookie2 = await signUpTestUser(app, "div-view-2@example.com");
    const portfolios = await tdb.db.select().from(portfolio);
    const portfolioId2 = portfolios.find((row) => row.id !== portfolioId)!.id;
    await tdb.db.insert(instrument).values({
      symbol: "NODATA",
      name: "Mystery ETF",
      exchange: "XNYS",
      currency: "USD",
      assetType: "etf",
    });
    await tdb.db.insert(transaction).values({
      portfolioId: portfolioId2,
      instrumentSymbol: "NODATA",
      type: "buy",
      quantity: "2",
      price: "40",
      currency: "USD",
      tradeDate: "2026-01-02",
    });
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  async function fetchView(qs = ""): Promise<DiversificationViewBody> {
    const res = await app.request(`/portfolio/diversification${qs}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    return (await res.json()) as DiversificationViewBody;
  }

  it("returns totals in both bases and one row per position in single-array dimensions", async () => {
    const body = await fetchView();
    expect(body.currency).toBe("USD");
    expect(body.totals.marketValue).toEqual({ amount: "4700.00", currency: "USD" });
    expect(body.totals.costBasis).toEqual({ amount: "4500.00", currency: "USD" });
    for (const dim of [
      body.dimensions.country,
      body.dimensions.region,
      body.dimensions.assetClass,
      body.dimensions.currency,
    ]) {
      expect(dim).toHaveLength(3);
      expect(new Set(dim.map((r) => r.symbol))).toEqual(new Set(["AAPL", "VOO", "MY_SAVINGS"]));
    }
  });

  it("buckets sector.plain with funds opaque and custom sector honored", async () => {
    const body = await fetchView();
    const plain = body.dimensions.sector.plain;
    expect(plain).toHaveLength(3);
    const bySymbol = new Map(plain.map((r) => [r.symbol, r]));
    expect(bySymbol.get("AAPL")).toMatchObject({
      bucket: "Technology",
      isFund: false,
      marketValue: { amount: "1600.00", currency: "USD" },
      costValue: { amount: "1500.00", currency: "USD" },
    });
    expect(bySymbol.get("VOO")).toMatchObject({ bucket: "Funds", isFund: true });
    expect(bySymbol.get("MY_SAVINGS")).toMatchObject({ bucket: "Banking" });
  });

  it("decomposes funds in sector.xray with canonical labels and an Unknown residual", async () => {
    const body = await fetchView();
    const xray = body.dimensions.sector.xray;
    const vooRows = xray.filter((r) => r.symbol === "VOO");
    expect(vooRows).toHaveLength(3);
    const byBucket = new Map(vooRows.map((r) => [r.bucket, r]));
    expect(byBucket.get("Technology")).toMatchObject({
      marketValue: { amount: "1260.00", currency: "USD" },
      costValue: { amount: "1200.00", currency: "USD" },
      fundWeightPct: 60,
    });
    expect(byBucket.get("Financial Services")).toMatchObject({
      marketValue: { amount: "777.00", currency: "USD" },
      fundWeightPct: 37,
    });
    expect(byBucket.get("Unknown")).toMatchObject({
      marketValue: { amount: "63.00", currency: "USD" },
      fundWeightPct: 3,
    });
    // Non-fund rows are identical to plain.
    const aapl = xray.find((r) => r.symbol === "AAPL");
    expect(aapl).toMatchObject({ bucket: "Technology" });
    expect(aapl!.fundWeightPct).toBeUndefined();
  });

  it("merges direct and via-fund exposure in holdingsXray with a remainder constituent", async () => {
    const body = await fetchView();
    const byKey = new Map(body.holdingsXray.map((c) => [c.key, c]));

    const aapl = byKey.get("AAPL");
    expect(aapl).toBeDefined();
    expect(aapl!.marketValue).toEqual({ amount: "1747.00", currency: "USD" });
    expect(aapl!.sources).toHaveLength(2);
    const fundSource = aapl!.sources.find((s) => s.type === "fund");
    expect(fundSource).toMatchObject({
      fundSymbol: "VOO",
      marketValue: { amount: "147.00", currency: "USD" },
    });

    expect(byKey.get("MSFT")).toMatchObject({
      marketValue: { amount: "126.00", currency: "USD" },
    });

    const other = byKey.get("VOO:other");
    expect(other).toMatchObject({
      symbol: null,
      name: "VOO — other holdings",
      marketValue: { amount: "1827.00", currency: "USD" },
    });

    // Sorted by marketValue descending: remainder first.
    expect(body.holdingsXray[0]!.key).toBe("VOO:other");
  });

  it("classifies custom holdings from custom_holding settings", async () => {
    const body = await fetchView();
    const custom = body.dimensions.country.find((r) => r.symbol === "MY_SAVINGS");
    expect(custom).toMatchObject({ bucket: "Denmark" });
    const region = body.dimensions.region.find((r) => r.symbol === "MY_SAVINGS");
    expect(region).toMatchObject({ bucket: "Unknown" });
    const assetClass = body.dimensions.assetClass.find((r) => r.symbol === "MY_SAVINGS");
    expect(assetClass).toMatchObject({ bucket: "custom" });
  });

  it("keeps funds without composition data opaque — no fake look-through", async () => {
    const res = await app.request("/portfolio/diversification", { headers: { cookie: cookie2 } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiversificationViewBody;
    // Opaque "Funds" row in BOTH sector arrays (market 2 × $50 = 100).
    for (const rows of [body.dimensions.sector.plain, body.dimensions.sector.xray]) {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        symbol: "NODATA",
        bucket: "Funds",
        isFund: true,
        marketValue: { amount: "100.00", currency: "USD" },
      });
      expect(rows[0]!.fundWeightPct).toBeUndefined();
    }
    // holdingsXray: a single direct constituent, like a stock.
    expect(body.holdingsXray).toHaveLength(1);
    expect(body.holdingsXray[0]).toMatchObject({
      key: "NODATA",
      symbol: "NODATA",
      sources: [{ type: "direct", marketValue: { amount: "100.00", currency: "USD" } }],
    });
  });

  it("converts both bases with the target/source divide convention", async () => {
    const body = await fetchView("?currency=EUR");
    expect(body.currency).toBe("EUR");
    // rate EUR/USD = 0.5 → divide: 4700 / 0.5 = 9400
    expect(body.totals.marketValue).toEqual({ amount: "9400.00", currency: "EUR" });
    expect(body.totals.costBasis).toEqual({ amount: "9000.00", currency: "EUR" });
    const aapl = body.dimensions.sector.plain.find((r) => r.symbol === "AAPL");
    expect(aapl!.marketValue).toEqual({ amount: "3200.00", currency: "EUR" });
    expect(body.fxIncomplete).toBe(false);
  });

  it("flags fxIncomplete and passes values through when no rates are available", async () => {
    const emptyFxStub: IFxRateService = {
      getRate: () => Promise.reject(new Error("FX rate unavailable")),
      getRates: () => Promise.resolve(new Map()),
    };
    // Same db and auth secret — the existing session cookie stays valid.
    const authNoFx = createAuth(tdb.db, testEnv);
    const appNoFx = createApp(tdb.db, provider, authNoFx, undefined, emptyFxStub);
    const res = await appNoFx.request("/portfolio/diversification?currency=EUR", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiversificationViewBody;
    expect(body.fxIncomplete).toBe(true);
    expect(body.fxStale).toBe(false); // nothing was converted at all
    // USD values pass through unconverted, still labeled in the display currency.
    expect(body.totals.marketValue).toEqual({ amount: "4700.00", currency: "EUR" });
  });

  it("degrades instead of 500ing when the FX lookup itself throws", async () => {
    // The ECB service reads the database, so `getRates` can now reject on a DB
    // hiccup where the old cache-backed chain ended in a lookup that never
    // threw. Every sibling view (portfolio, categories, dividend income)
    // catches this; an uncaught one here would turn a degraded FX read into a
    // dead page.
    const throwingFxStub: IFxRateService = {
      getRate: () => Promise.reject(new Error("connection terminated")),
      getRates: () => Promise.reject(new Error("connection terminated")),
    };
    const appThrowingFx = createApp(
      tdb.db,
      provider,
      createAuth(tdb.db, testEnv),
      undefined,
      throwingFxStub,
    );
    const res = await appThrowingFx.request("/portfolio/diversification?currency=EUR", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiversificationViewBody;
    expect(body.fxIncomplete).toBe(true);
    expect(body.totals.marketValue).toEqual({ amount: "4700.00", currency: "EUR" });
  });

  /**
   * Seeds fx_rate_daily with ONE publication day, replacing whatever was there.
   * `latestDate()` is a MAX over the whole table, so a leftover row from an
   * earlier test would decide which day gets served.
   *
   * Dates are relative to now on purpose: an absolute date silently stops
   * exercising the staleness branch the moment it drifts past the threshold.
   */
  async function seedEcbRates(daysAgo: number, usdPerEur: string) {
    const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    await tdb.db.delete(fxRateDaily);
    await tdb.db.insert(fxRateDaily).values({ date, currency: "USD", rate: usdPerEur });
  }

  function appWithEcbFx() {
    return createApp(
      tdb.db,
      provider,
      createAuth(tdb.db, testEnv),
      undefined,
      new EcbFxRateService(tdb.db),
    );
  }

  async function fetchWithEcbFx(): Promise<DiversificationViewBody> {
    const res = await appWithEcbFx().request("/portfolio/diversification?currency=EUR", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as DiversificationViewBody;
  }

  it("does not flag fxStale when every currency is priced from fresh rates", async () => {
    await seedEcbRates(0, "2");
    const body = await fetchWithEcbFx();
    expect(body.fxStale).toBe(false);
    expect(body.fxIncomplete).toBe(false);
    // 2 USD per EUR; source → target converts by DIVIDING: 4700 / 2.
    expect(body.totals.marketValue).toEqual({ amount: "2350.00", currency: "EUR" });
  });

  it("flags fxStale when the newest stored rate is past the staleness threshold", async () => {
    await seedEcbRates(STALE_AFTER_DAYS + 3, "2");
    const body = await fetchWithEcbFx();
    expect(body.fxStale).toBe(true);
    // A stale rate still prices USD — the total is approximate, not missing.
    expect(body.fxIncomplete).toBe(false);
    expect(body.totals.marketValue).toEqual({ amount: "2350.00", currency: "EUR" });
  });
});
