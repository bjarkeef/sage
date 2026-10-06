import { it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { Decimal, Money } from "@sage/core";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { user, portfolio, instrument, transaction, dividendHistory } from "../db/schema";
import { assetRoutes } from "./asset";
import { portfolioRoutes } from "./portfolio";
import { dividendsRoutes } from "./dividends";
import type { AppEnv } from "../middleware/session";

/**
 * Spec decision 1 (2026-10-01): "received so far" is the ledger — cash that
 * actually landed — on /dividends, /holdings and the asset page alike.
 *
 * The provider history below deliberately disagrees with the ledger: the old
 * /holdings and asset-page rule (history × shares held) would read 20.00 for
 * KO, the ledger says 9.45. Auto-reconciliation is off for this portfolio, so
 * the ledger is exactly the rows inserted here and no read can add to it.
 *
 * Mounted on a bare Hono app with a stub user, as asset-income.integration.test.ts
 * does; dates are relative to the real clock because the routes read it.
 */
describeDb("received so far — one producer for /dividends, /holdings and the asset page", () => {
  let tdb: TestDb;
  let app: Hono<AppEnv>;
  let zeroRateApp: Hono<AppEnv>;
  const userId = "received-parity-user";
  const DAY = 24 * 60 * 60 * 1000;
  const iso = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
  const today = iso(0);

  beforeAll(async () => {
    tdb = await withTestDb();
    await tdb.db.insert(user).values({
      id: userId,
      name: "Parity User",
      email: "received-parity@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [pf] = await tdb.db
      .insert(portfolio)
      .values({ userId, name: "Default", autoAddDividends: false })
      .returning({ id: portfolio.id });
    const portfolioId = pf!.id;

    await tdb.db.insert(instrument).values([
      {
        symbol: "KO",
        name: "Example Beverages",
        exchange: "XNYS",
        currency: "USD",
        assetType: "stock",
      },
      {
        symbol: "O",
        name: "Example Realty",
        exchange: "XNYS",
        currency: "USD",
        assetType: "stock",
      },
      {
        symbol: "MSFT",
        name: "Example Software",
        exchange: "XNAS",
        currency: "USD",
        assetType: "stock",
      },
      {
        symbol: "NORDA-B",
        name: "Example Nordic",
        exchange: "XCSE",
        currency: "DKK",
        assetType: "stock",
      },
    ]);

    const tx = (
      symbol: string,
      type: "buy" | "dividend",
      quantity: string,
      price: string,
      tradeDate: string,
      source: string | null = null,
    ) => ({
      portfolioId,
      instrumentSymbol: symbol,
      type,
      quantity,
      price,
      currency: "USD",
      tradeDate,
      source,
    });

    await tdb.db.insert(transaction).values([
      tx("KO", "buy", "10", "50", iso(-400)),
      // What actually landed, gross: 4.60 + 4.85 = 9.45.
      tx("KO", "dividend", "10", "0.46", iso(-200)),
      tx("KO", "dividend", "10", "0.485", iso(-110), "auto"),
      // Dated ahead: not received yet, on any page.
      tx("KO", "dividend", "10", "0.485", iso(20)),
      tx("O", "buy", "5", "60", iso(-400)),
      tx("O", "dividend", "5", "0.25", iso(-30)),
      tx("MSFT", "buy", "2", "200", iso(-400)),
      // A DKK holding whose dividend was paid in USD: needs a USD -> DKK rate.
      { ...tx("NORDA-B", "buy", "10", "100", iso(-400)), currency: "DKK" },
      tx("NORDA-B", "dividend", "10", "1", iso(-30)),
    ]);

    // Provider history that disagrees with the ledger: 4 × 0.50 × 10 = 20.00,
    // every payment already paid, so none of it is in flight on /dividends.
    await tdb.db.insert(dividendHistory).values(
      [-300, -210, -120, -40].map((o) => ({
        symbol: "KO",
        exDate: iso(o),
        paymentDate: iso(o + 10),
        paymentDateEstimated: false,
        amountPerShare: "0.50",
        currency: "USD",
        source: "test",
      })),
    );

    const quote = (symbol: string, price: string) => ({
      symbol,
      price: Money.of(price, "USD"),
      asOf: new Date(),
      previousClose: null,
    });
    const provider = new FakeMarketDataProvider({
      quotes: {
        KO: quote("KO", "50"),
        O: quote("O", "60"),
        MSFT: quote("MSFT", "200"),
        "NORDA-B": { ...quote("NORDA-B", "100"), price: Money.of("100", "DKK") },
      },
    });

    app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("user", { id: userId });
      c.set("session", {});
      await next();
    });
    app.route("/asset", assetRoutes(tdb.db, provider));
    zeroRateApp = new Hono<AppEnv>();
    zeroRateApp.use("*", async (c, next) => {
      c.set("user", { id: userId });
      c.set("session", {});
      await next();
    });
    zeroRateApp.route(
      "/asset",
      assetRoutes(tdb.db, provider, undefined, {
        getRate: () => Promise.resolve(new Decimal(0)),
        getRates: () => Promise.resolve(new Map()),
      }),
    );
    app.route("/portfolio", portfolioRoutes(tdb.db, provider));
    app.route("/dividends", dividendsRoutes(tdb.db, provider));
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  type IncomeBody = {
    retroactive: {
      symbol: string;
      exDate: string;
      paymentDate: string | null;
      income: string;
      currency: string;
    }[];
  };
  type AssetBody = {
    position: { dividendsReceived?: { amount: string; currency: string; leftOut: number } | null };
  };
  type PortfolioBody = {
    positions: { symbol: string; dividendIncome: { amount: string; currency: string } | null }[];
  };

  /** What /dividends lists as received for one symbol: cash dated today or earlier. */
  async function dividendsReceived(symbol: string): Promise<number> {
    const body = (await (await app.request("/dividends/income")).json()) as IncomeBody;
    return body.retroactive
      .filter((r) => r.symbol === symbol && (r.paymentDate ?? r.exDate) <= today)
      .reduce((s, r) => s + Number(r.income), 0);
  }

  it("the asset page's figure is the sum of the symbol's received rows on /dividends", async () => {
    const ledger = await dividendsReceived("KO");
    expect(ledger).toBeCloseTo(9.45, 10);

    const asset = (await (await app.request("/asset/KO")).json()) as AssetBody;
    expect(asset.position.dividendsReceived).toEqual({
      amount: "9.45",
      currency: "USD",
      leftOut: 0,
    });
    expect(Number(asset.position.dividendsReceived!.amount)).toBeCloseTo(ledger, 10);
  });

  it("/holdings reads the same rows — never provider history × shares", async () => {
    const ledger = await dividendsReceived("KO");
    const body = (await (await app.request("/portfolio")).json()) as PortfolioBody;
    const ko = body.positions.find((p) => p.symbol === "KO")!;
    expect(ko.dividendIncome!.currency).toBe("USD");
    expect(Number(ko.dividendIncome!.amount)).toBeCloseTo(ledger, 10);
    // The old rule would read 20.00.
    expect(Number(ko.dividendIncome!.amount)).not.toBeCloseTo(20, 2);
  });

  it("keeps each holding's rows to itself", async () => {
    const asset = (await (await app.request("/asset/O")).json()) as AssetBody;
    expect(asset.position.dividendsReceived).toEqual({
      amount: "1.25",
      currency: "USD",
      leftOut: 0,
    });
    expect(await dividendsReceived("O")).toBeCloseTo(1.25, 10);
  });

  it("a holding that has received nothing reads null on both — not zero", async () => {
    const asset = (await (await app.request("/asset/MSFT")).json()) as AssetBody;
    expect(asset.position.dividendsReceived).toBeNull();
    const body = (await (await app.request("/portfolio")).json()) as PortfolioBody;
    expect(body.positions.find((p) => p.symbol === "MSFT")!.dividendIncome).toBeNull();
  });

  it("a zero FX rate leaves the row out and counts it — never converts it to nothing", async () => {
    const asset = (await (await zeroRateApp.request("/asset/NORDA-B")).json()) as AssetBody;
    expect(asset.position.dividendsReceived).toEqual({
      amount: "0.00",
      currency: "DKK",
      leftOut: 1,
    });
  });
});
