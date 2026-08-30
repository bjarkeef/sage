import { it, expect, beforeAll, afterAll } from "vitest";
import { Money } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { Quote } from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { dividendHistory, assetProfile } from "../db/schema";

const apple = {
  symbol: "AAPL",
  name: "Apple Inc",
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

function quote(symbol: string, price: string, ccy: string): Quote {
  return { symbol, price: Money.of(price, ccy), asOf: new Date("2026-06-19"), previousClose: null };
}

async function post(app: ReturnType<typeof createApp>, body: unknown, cookie: string) {
  return app.request("/transactions", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describeDb("GET /portfolio", () => {
  let tdb: TestDb;
  let cookie: string;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    tdb = await withTestDb();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, new FakeMarketDataProvider(), auth);
    cookie = await signUpTestUser(app);
  }, 120_000);
  afterAll(async () => {
    await tdb?.stop();
  });

  it("computes positions, market value, and per-currency subtotals", async () => {
    const provider = new FakeMarketDataProvider({
      quotes: {
        AAPL: quote("AAPL", "150", "USD"),
        "GLOBIX.XLON": quote("GLOBIX.XLON", "100", "GBP"),
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    await post(
      app,
      {
        instrument: apple,
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: "2026-01-01",
      },
      cookie,
    );
    await post(
      app,
      {
        instrument: globix,
        type: "buy",
        quantity: "5",
        price: "90",
        tradeDate: "2026-01-02",
      },
      cookie,
    );

    const res = await app.request("/portfolio", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      positions: {
        symbol: string;
        marketValue: unknown;
        costBasis: unknown;
        unrealizedGainLoss: unknown;
      }[];
      subtotalsByCurrency: { currency: string; marketValue: unknown }[];
    };

    const aapl = body.positions.find((p) => p.symbol === "AAPL");
    expect(aapl!.marketValue).toEqual({ amount: "1500", currency: "USD" });
    expect(aapl!.costBasis).toEqual({ amount: "1000", currency: "USD" });
    expect(aapl!.unrealizedGainLoss).toEqual({ amount: "500", currency: "USD" });

    const usd = body.subtotalsByCurrency.find((s) => s.currency === "USD");
    expect(usd!.marketValue).toEqual({ amount: "1500", currency: "USD" });
    const gbp = body.subtotalsByCurrency.find((s) => s.currency === "GBP");
    expect(gbp!.marketValue).toEqual({ amount: "500", currency: "GBP" });
  });

  it("returns a null price for a position whose quote fails, without failing the response", async () => {
    // Provider has no quote for GLOBIX.XLON here -> getQuote rejects.
    const provider = new FakeMarketDataProvider({ quotes: { AAPL: quote("AAPL", "150", "USD") } });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    const res = await app.request("/portfolio", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      positions: { symbol: string; currentPrice: unknown; marketValue: unknown }[];
    };
    const globixPos = body.positions.find((p) => p.symbol === "GLOBIX.XLON");
    expect(globixPos!.currentPrice).toBeNull();
    expect(globixPos!.marketValue).toBeNull();
  });

  it("excludes unpriced positions from a currency's subtotal market value and gain/loss, but not its cost basis", async () => {
    // Same-currency mix: AAPL is priced, MSFT is not. The USD subtotal cost basis
    // must include both, while market value and gain/loss include only AAPL — so
    // gain/loss stays paired with the priced market value, never skewed by MSFT.
    const provider = new FakeMarketDataProvider({
      quotes: { AAPL: quote("AAPL", "150", "USD") }, // no MSFT, no GLOBIX quote
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    await post(
      app,
      {
        instrument: msft,
        type: "buy",
        quantity: "2",
        price: "200", // cost basis 400
        tradeDate: "2026-01-03",
      },
      cookie,
    );

    const res = await app.request("/portfolio", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      subtotalsByCurrency: {
        currency: string;
        costBasis: unknown;
        marketValue: unknown;
        gainLoss: unknown;
      }[];
    };

    const usd = body.subtotalsByCurrency.find((s) => s.currency === "USD");
    // AAPL cost 1000 + MSFT cost 400 = 1400 (all positions).
    expect(usd!.costBasis).toEqual({ amount: "1400", currency: "USD" });
    // Only AAPL is priced: market value 1500, gain/loss 500 (not 1500 - 1400 = 100).
    expect(usd!.marketValue).toEqual({ amount: "1500", currency: "USD" });
    expect(usd!.gainLoss).toEqual({ amount: "500", currency: "USD" });
  });

  it("enriches a position with daily change, dividend income, total return, and website", async () => {
    const provider = new FakeMarketDataProvider({
      quotes: {
        NVDA: {
          symbol: "NVDA",
          price: Money.of("150", "USD"),
          asOf: new Date("2026-06-19"),
          previousClose: Money.of("148", "USD"),
        },
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);

    await post(
      app,
      { instrument: nvda, type: "buy", quantity: "10", price: "100", tradeDate: "2026-01-01" },
      cookie,
    );
    // 10 shares held on the ex-date -> $2 * 10 = $20 of retroactive income.
    await tdb.db.insert(dividendHistory).values({
      symbol: "NVDA",
      exDate: "2026-03-01",
      amountPerShare: "2",
      currency: "USD",
      source: "test",
    });
    await tdb.db.insert(assetProfile).values({
      symbol: "NVDA",
      name: "NVIDIA Corp",
      exchange: "XNAS",
      currency: "USD",
      website: "https://nvidia.com",
    });

    const res = await app.request("/portfolio", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      positions: {
        symbol: string;
        dailyChange: { amount: string; currency: string } | null;
        dailyChangePercent: number | null;
        dividendIncome: { amount: string; currency: string } | null;
        totalReturn: { amount: string; currency: string } | null;
        totalReturnPercent: number | null;
        website: string | null;
      }[];
    };
    const nv = body.positions.find((p) => p.symbol === "NVDA")!;
    // price 150 vs previous close 148 -> +2 over 148 = +1.3514%; 10 shares -> +$20 today.
    expect(nv.dailyChangePercent).toBeCloseTo(1.3514, 3);
    expect(nv.dailyChange).toEqual({ amount: "20", currency: "USD" });
    expect(nv.dividendIncome).toEqual({ amount: "20", currency: "USD" });
    // gain/loss 500 + dividends 20 = 520; over cost basis 1000 = 52%.
    expect(nv.totalReturn).toEqual({ amount: "520", currency: "USD" });
    expect(nv.totalReturnPercent).toBeCloseTo(52, 4);
    expect(nv.website).toBe("https://nvidia.com");
  });

  it("excludes ex-passed-but-unpaid dividends from received income and total return", async () => {
    const realty = {
      symbol: "O",
      name: "Realty Income",
      exchange: "XNYS",
      currency: "USD",
      assetType: "stock",
    };
    const provider = new FakeMarketDataProvider({
      quotes: { O: quote("O", "150", "USD") },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);

    // 10 shares @ 100 -> cost basis 1000, market value 1500, unrealized +500.
    await post(
      app,
      { instrument: realty, type: "buy", quantity: "10", price: "100", tradeDate: "2026-01-01" },
      cookie,
    );
    await tdb.db.insert(dividendHistory).values([
      // Received: ex-date and payment date both in the past -> 10 * 2 = $20.
      {
        symbol: "O",
        exDate: "2026-03-01",
        amountPerShare: "2",
        currency: "USD",
        paymentDate: "2026-03-15",
        paymentDateEstimated: false,
        source: "test",
      },
      // In-flight: ex-date passed but payment still ahead -> must NOT be counted
      // as received (would otherwise add 10 * 3 = $30).
      {
        symbol: "O",
        exDate: "2026-07-01",
        amountPerShare: "3",
        currency: "USD",
        paymentDate: "2100-08-15",
        paymentDateEstimated: false,
        source: "test",
      },
    ]);

    const res = await app.request("/portfolio", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      positions: {
        symbol: string;
        dividendIncome: { amount: string; currency: string } | null;
        totalReturn: { amount: string; currency: string } | null;
      }[];
    };
    const o = body.positions.find((p) => p.symbol === "O")!;
    // Only the paid $20 counts — the future-dated $30 is excluded.
    expect(o.dividendIncome).toEqual({ amount: "20", currency: "USD" });
    // Total return = 500 unrealized + 20 received (not 550).
    expect(o.totalReturn).toEqual({ amount: "520", currency: "USD" });
  });

  it("removes a holding: deletes all the symbol's transactions and drops it from the portfolio", async () => {
    const provider = new FakeMarketDataProvider({
      quotes: { AAPL: quote("AAPL", "150", "USD") },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);

    // AAPL already has transactions from earlier tests; confirm it's present, then remove it.
    const before = await app.request("/portfolio", {
      headers: { cookie },
    });
    const beforeBody = (await before.json()) as { positions: { symbol: string }[] };
    expect(beforeBody.positions.some((p) => p.symbol === "AAPL")).toBe(true);

    const del = await app.request("/portfolio/positions/AAPL", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(204);

    const after = await app.request("/portfolio", {
      headers: { cookie },
    });
    const afterBody = (await after.json()) as { positions: { symbol: string }[] };
    expect(afterBody.positions.some((p) => p.symbol === "AAPL")).toBe(false);

    // Removing a symbol with no transactions -> 404.
    const again = await app.request("/portfolio/positions/AAPL", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(again.status).toBe(404);
  });
});
