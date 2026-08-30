import { it, expect, beforeAll, afterAll } from "vitest";
import { Money, Decimal } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { PriceBar, IFxRateService } from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function bar(date: string, close: string, ccy = "USD"): PriceBar {
  const p = Money.of(close, ccy);
  return {
    date: new Date(date),
    open: p,
    high: p,
    low: p,
    close: p,
    volume: new Decimal(1000),
  };
}

describeDb("GET /portfolio/history", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    const provider = new FakeMarketDataProvider({
      history: {
        AAPL: [bar(daysAgo(3), "190"), bar(daysAgo(2), "195"), bar(daysAgo(1), "200")],
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "chart@test.com");

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: {
          symbol: "AAPL",
          name: "Apple Inc.",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "150",
        tradeDate: "2026-06-01",
      }),
    });
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("returns historical portfolio value points", async () => {
    const res = await app.request("/portfolio/history?range=1W", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      points: { date: string; value: { amount: string; currency: string } }[];
      changePercent: number;
      changeAmount: { amount: string; currency: string };
    };
    expect(body.points.length).toBeGreaterThan(0);
    expect(body.points[0]).toHaveProperty("date");
    expect(body.points[0]).toHaveProperty("value");
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/portfolio/history?range=1M");
    expect(res.status).toBe(401);
  });

  it("includes non-target currencies converted at the current fx rate", async () => {
    // NORDA-B trades in DKK; fx stub: 7 DKK per USD (converted = amount / rate).
    const provider = new FakeMarketDataProvider({
      history: {
        AAPL: [bar(daysAgo(3), "190"), bar(daysAgo(2), "195"), bar(daysAgo(1), "200")],
        "NORDA-B": [
          bar(daysAgo(3), "630", "DKK"),
          bar(daysAgo(2), "665", "DKK"),
          bar(daysAgo(1), "700", "DKK"),
        ],
      },
    });
    const fx: IFxRateService = {
      getRate: () => Promise.resolve(new Decimal(7)),
      getRates: () => Promise.resolve(new Map([["DKK", new Decimal(7)]])),
    };
    const auth = createAuth(tdb.db, testEnv);
    const fxApp = createApp(tdb.db, provider, auth, undefined, fx);

    await fxApp.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: {
          symbol: "NORDA-B",
          name: "Norda Industri",
          exchange: "XCSE",
          currency: "DKK",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "600",
        tradeDate: "2026-06-01",
      }),
    });

    const res = await fxApp.request("/portfolio/history?range=1W&currency=USD", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      points: { date: string; value: { amount: string; currency: string } }[];
    };
    const last = body.points[body.points.length - 1]!;
    // AAPL: 10 sh × $200 = 2000; NORDA-B: 10 sh × 700 DKK / 7 = 1000 → 3000 USD
    expect(last.value.currency).toBe("USD");
    expect(last.value.amount).toBe("3000.00");
  });

  it("forward-fills a symbol's last close across missing bar dates", async () => {
    // NORDA-B has no bar on daysAgo(2) — e.g. a Danish market holiday. Its
    // daysAgo(3) close must carry forward instead of dropping the position.
    const provider = new FakeMarketDataProvider({
      history: {
        AAPL: [bar(daysAgo(3), "190"), bar(daysAgo(2), "195"), bar(daysAgo(1), "200")],
        "NORDA-B": [bar(daysAgo(3), "630", "DKK"), bar(daysAgo(1), "700", "DKK")],
      },
    });
    const fx: IFxRateService = {
      getRate: () => Promise.resolve(new Decimal(7)),
      getRates: () => Promise.resolve(new Map([["DKK", new Decimal(7)]])),
    };
    const auth = createAuth(tdb.db, testEnv);
    const ffApp = createApp(tdb.db, provider, auth, undefined, fx);

    const res = await ffApp.request("/portfolio/history?range=1W&currency=USD", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      points: { date: string; value: { amount: string; currency: string } }[];
    };
    // Middle day: AAPL 10 × 195 = 1950; NORDA-B carries 630 DKK / 7 × 10 = 900 → 2850
    const middle = body.points.find((p) => p.date === daysAgo(2));
    expect(middle).toBeDefined();
    expect(middle!.value.amount).toBe("2850.00");
  });
});

describeDb("GET /portfolio/history — transaction replay", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  // 5-bar fixture: AAPL is bought on d3 and half-sold on d4, so d1/d2 predate
  // the position entirely and d3-d4 exercise the buy/sell steps.
  const d1 = daysAgo(4);
  const d2 = daysAgo(3);
  const d3 = daysAgo(2);
  const d4 = daysAgo(1);
  const d5 = daysAgo(0);

  beforeAll(async () => {
    tdb = await withTestDb();

    const provider = new FakeMarketDataProvider({
      history: {
        AAPL: [bar(d1, "100"), bar(d2, "105"), bar(d3, "110"), bar(d4, "110"), bar(d5, "176")],
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "chart@test.com");

    const instrument = {
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "NMS",
      currency: "USD",
      assetType: "stock",
    };

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument,
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: d3,
      }),
    });

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument,
        type: "sell",
        quantity: "5",
        price: "120",
        tradeDate: d4,
      }),
    });
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  async function fetchHistory(range = "ALL") {
    const res = await app.request(`/portfolio/history?range=${range}&currency=USD`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      points: {
        date: string;
        value: { amount: string; currency: string };
        invested: { amount: string; currency: string };
      }[];
      changePercent: number;
      changeAmount: { amount: string; currency: string };
    };
  }

  it("excludes pre-purchase dates and steps in on the buy date", async () => {
    const body = await fetchHistory();
    expect(body.points.find((p) => p.date === d1)).toBeUndefined();
    expect(body.points.find((p) => p.date === d2)).toBeUndefined();
    const buyDay = body.points.find((p) => p.date === d3);
    expect(buyDay).toBeDefined();
    expect(buyDay!.value.amount).toBe("1100.00");
    expect(buyDay!.invested.amount).toBe("1000.00");
  });

  it("halves value and drops invested by sale proceeds on the sell date", async () => {
    const body = await fetchHistory();
    const sellDay = body.points.find((p) => p.date === d4);
    expect(sellDay).toBeDefined();
    expect(sellDay!.value.amount).toBe("550.00");
    expect(sellDay!.invested.amount).toBe("400.00");
  });

  it("clamps the range to the portfolio's inception date and baselines change there", async () => {
    const body = await fetchHistory("ALL");
    expect(body.points[0]!.date).toBe(d3);
    expect(body.changeAmount.amount).toBe("-220.00");
    expect(body.changePercent).toBe(-20);
  });

  it("carries an invested field on every point", async () => {
    const body = await fetchHistory();
    expect(body.points.length).toBeGreaterThan(0);
    for (const point of body.points) {
      expect(point.invested).toBeDefined();
      expect(point.invested.currency).toBe("USD");
      expect(typeof point.invested.amount).toBe("string");
    }
  });

  it("defaults to a 1Y range when none is specified", async () => {
    const [defaultRes, explicitRes] = await Promise.all([
      app.request("/portfolio/history?currency=USD", { headers: { cookie } }),
      app.request("/portfolio/history?range=1Y&currency=USD", { headers: { cookie } }),
    ]);
    expect(defaultRes.status).toBe(200);
    expect(explicitRes.status).toBe(200);
    const [defaultBody, explicitBody] = await Promise.all([defaultRes.json(), explicitRes.json()]);
    expect(defaultBody).toEqual(explicitBody);
  });
});

describeDb("GET /portfolio/history — default currency fallback", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    const provider = new FakeMarketDataProvider({
      history: {
        "NORDA-B": [bar(daysAgo(1), "100", "DKK")],
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "chart@test.com");

    const post = (body: object) =>
      app.request("/transactions", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
    const aapl = {
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "NMS",
      currency: "USD",
      assetType: "stock",
    };
    const norda = {
      symbol: "NORDA-B",
      name: "Norda Industri",
      exchange: "CPH",
      currency: "DKK",
      assetType: "stock",
    };

    // Fully exited USD position sold at a loss leaves net-invested residue of
    // USD 500, larger than the DKK 300 still held — the no-currency fallback
    // must ignore exited residue and pick the held currency.
    await post({
      instrument: aapl,
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: daysAgo(40),
    });
    await post({
      instrument: aapl,
      type: "sell",
      quantity: "10",
      price: "50",
      tradeDate: daysAgo(39),
    });
    await post({
      instrument: norda,
      type: "buy",
      quantity: "3",
      price: "100",
      tradeDate: daysAgo(20),
    });
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("ignores net-invested residue of fully-exited positions when no currency is given", async () => {
    const res = await app.request("/portfolio/history?range=1M", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      points: { value: { currency: string } }[];
      changeAmount: { currency: string };
    };
    expect(body.changeAmount.currency).toBe("DKK");
    expect(body.points.length).toBeGreaterThan(0);
    expect(body.points[0]!.value.currency).toBe("DKK");
  });
});
