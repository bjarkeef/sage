import { it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Money, Decimal } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type {
  PriceBar,
  IFxRateService,
  IMarketDataProvider,
  Quote,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { PriceStore } from "../market-data/price-store";
import {
  PersistedPriceProvider,
  resetPriceAttemptsForTests,
  drainPriceRefreshesForTests,
} from "../market-data/persisted-price-provider";

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

interface PerformanceBody {
  displayCurrency: string;
  range: string;
  window: { from: string; to: string; days: number } | null;
  insufficientData: boolean;
  twr: number | null;
  twrAnnualized: number | null;
  mwr: number | null;
  mwrAnnualized: number | null;
  volatility: number | null;
  maxDrawdown: number | null;
  bestDay: { date: string; value: number } | null;
  worstDay: { date: string; value: number } | null;
  indexSeries: { date: string; value: number }[];
  benchmarks: {
    id: string;
    name: string;
    twr: number;
    points: { date: string; value: number }[];
  }[];
  multiCurrency: boolean;
  anomalousDays: number;
  fxApproximated: boolean;
  unverifiedSplits: string[];
  historyIncomplete: string[];
  basisMismatches: {
    symbol: string;
    factor: number;
    mismatched: number;
    samples: number;
    firstDate: string;
    lastDate: string;
  }[];
  relative: {
    benchmarkId: string;
    benchmarkName: string;
    pairedDays: number;
    minPairedDaysForBeta: number;
    volatility: { value: number; benchmark: number; ratio: number } | null;
    maxDrawdown: { value: number; benchmark: number; ratio: number } | null;
    beta: number | null;
  } | null;
}

describeDb("GET /performance", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    const provider = new FakeMarketDataProvider({
      history: {
        AAPL: [bar(daysAgo(365), "100"), bar(daysAgo(182), "110"), bar(daysAgo(1), "121")],
        "GSPC.INDX": [bar(daysAgo(365), "100"), bar(daysAgo(1), "110")],
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "perf@test.com");

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
        quantity: "1",
        price: "100",
        tradeDate: daysAgo(365),
      }),
    });

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument,
        type: "dividend",
        quantity: "1",
        price: "5",
        tradeDate: daysAgo(182),
      }),
    });
  }, 90_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("computes TWR, MWR, risk stats, and the index series", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PerformanceBody;

    expect(body.insufficientData).toBe(false);
    expect(body.displayCurrency).toBe("USD");
    // r1 = (110 + 5)/100 − 1 = 0.15 ; r2 = 121/110 − 1 = 0.10 ; TWR = 1.15×1.10 − 1
    expect(body.twr).toBeCloseTo(0.265, 4);
    // Single-currency book: nothing was converted, so nothing was approximated.
    expect(body.fxApproximated).toBe(false);
    expect(body.twrAnnualized).toBeNull(); // window ≤ 365 days
    // XIRR of −100 @ d0, +5 @ ~d183, +121 @ ~d364 ≈ 0.27 annualized
    expect(body.mwr).toBeGreaterThan(0.25);
    expect(body.mwr).toBeLessThan(0.29);
    expect(body.mwrAnnualized).toBeNull();
    // stdev(0.15, 0.10) × √252 = 0.025/√2 … = 0.5612
    expect(body.volatility).toBeCloseTo(0.5612, 3);
    expect(body.maxDrawdown).toBeCloseTo(0, 6);
    expect(body.bestDay!.value).toBeCloseTo(0.15, 4);
    expect(body.worstDay!.value).toBeCloseTo(0.1, 4);
    expect(body.indexSeries.map((p) => Number(p.value.toFixed(4)))).toEqual([1, 1.15, 1.265]);
    expect(body.window!.days).toBeGreaterThan(300);
    expect(body.multiCurrency).toBe(false);
  });

  it("includes benchmark TWR over the same window", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    const body = (await res.json()) as PerformanceBody;
    const sp = body.benchmarks.find((b) => b.id === "sp500")!;
    expect(sp.twr).toBeCloseTo(0.1, 4);
    expect(sp.points[0]!.value).toBeCloseTo(1, 6);
    expect(sp.points[sp.points.length - 1]!.value).toBeCloseTo(1.1, 4);
  });

  it("reports an empty unverified-splits list for a book without splits", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    const body = (await res.json()) as PerformanceBody;
    expect(body.unverifiedSplits).toEqual([]);
  });

  it("reports an empty basis-mismatch list for a clean book", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    const body = (await res.json()) as PerformanceBody;
    expect(body.basisMismatches).toEqual([]);
  });

  it("names the benchmark the relative scales are measured against", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    const body = (await res.json()) as PerformanceBody;
    expect(body.relative).not.toBeNull();
    expect(body.relative!.benchmarkId).toBe("sp500");
    expect(body.relative!.benchmarkName).toBe("S&P 500");
  });

  it("states the paired-day floor it applied", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    const body = (await res.json()) as PerformanceBody;
    expect(body.relative!.minPairedDaysForBeta).toBe(20);
  });

  it("suppresses everything it cannot honestly measure on a three-bar history", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    const body = (await res.json()) as PerformanceBody;
    const rel = body.relative!;
    // This fixture has two benchmark bars: one return, so no benchmark
    // volatility; a monotonic rise, so no benchmark drawdown to divide by; and
    // far fewer than 20 overlapping days, so no beta.
    expect(rel.pairedDays).toBeLessThan(rel.minPairedDaysForBeta);
    expect(rel.volatility).toBeNull();
    expect(rel.maxDrawdown).toBeNull();
    expect(rel.beta).toBeNull();
  });

  it("reports insufficientData honestly for an empty portfolio", async () => {
    const cookie2 = await signUpTestUser(app, "perf-empty@example.com");
    const res = await app.request("/performance", { headers: { cookie: cookie2 } });
    const body = (await res.json()) as PerformanceBody;
    expect(body.insufficientData).toBe(true);
    expect(body.twr).toBeNull();
    expect(body.mwr).toBeNull();
    expect(body.indexSeries).toEqual([]);
    expect(body.window).toBeNull();
    // Easiest of the three response paths to forget: a page that gives up on
    // a return figure can still say its prices are short (empty here, since
    // an empty series never fetched anything).
    expect(body.historyIncomplete).toEqual([]);
  });
});

describeDb("GET /performance — currency conversion and unpriceable symbols", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookieDkk: string;
  let cookieGhost: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    const provider = new FakeMarketDataProvider({
      history: {
        // A Danish-brokerage holding: the user paid in DKK, but the provider
        // quotes its bars in USD.
        "NORDA-DKK-USD": [bar(daysAgo(365), "190", "USD"), bar(daysAgo(1), "209", "USD")],
        AAPL: [bar(daysAgo(365), "100"), bar(daysAgo(1), "110")],
      },
    });
    // Divisor such that $190 ≈ 1310 DKK (converted = amount / divisor).
    const fx: IFxRateService = {
      getRate: () => Promise.resolve(new Decimal("0.145")),
      getRates: (_target, ccys) =>
        Promise.resolve(
          new Map(ccys.map((c) => [c, c === "USD" ? new Decimal("0.145") : new Decimal(1)])),
        ),
    };
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth, undefined, fx);

    cookieDkk = await signUpTestUser(app, "perf-dkk@test.com");
    cookieGhost = await signUpTestUser(app, "perf-ghost@test.com");

    // User 1: 1 share recorded in DKK at 1300; the provider values it in USD.
    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieDkk },
      body: JSON.stringify({
        instrument: {
          symbol: "NORDA-DKK-USD",
          name: "Norda (DKK-paid, USD-quoted)",
          exchange: "XCSE",
          currency: "DKK",
          assetType: "stock",
        },
        type: "buy",
        quantity: "1",
        price: "1300",
        tradeDate: daysAgo(365),
      }),
    });

    // User 2: a plain USD holding the provider prices.
    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieGhost },
      body: JSON.stringify({
        instrument: {
          symbol: "AAPL",
          name: "Apple Inc.",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "1",
        price: "100",
        tradeDate: daysAgo(365),
      }),
    });
  }, 90_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("values each bar in the bar's own currency, not the transaction currency", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500&currency=DKK", {
      headers: { cookie: cookieDkk },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PerformanceBody;

    expect(body.insufficientData).toBe(false);
    expect(body.displayCurrency).toBe("DKK");
    // Bar in USD went 190 → 209 (+10%). Valued in the bar's own currency this
    // is a clean +10%; the old bug valued "$190" as 190 DKK against the 1300
    // DKK cost and manufactured an ~−85% catastrophe.
    expect(body.twr).toBeCloseTo(0.1, 3);
    expect(body.anomalousDays).toBe(0);
    // FX conversion contributed (bar currency ≠ target).
    expect(body.multiCurrency).toBe(true);
    // This stub serves spot rates only, so every date was converted at today's
    // rate. The metrics above are therefore approximations and must say so —
    // an unlabelled TWR here would present an approximation as exact.
    expect(body.fxApproximated).toBe(true);
  });

  it("ignores a symbol the provider cannot price — no phantom flow or anomaly", async () => {
    const before = (await (
      await app.request("/performance?range=ALL&benchmarks=sp500", {
        headers: { cookie: cookieGhost },
      })
    ).json()) as PerformanceBody;
    expect(before.insufficientData).toBe(false);
    expect(before.anomalousDays).toBe(0);

    // Add a holding the provider has NO bars for.
    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieGhost },
      body: JSON.stringify({
        instrument: {
          symbol: "GHOST",
          name: "Unlisted Co.",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "5",
        price: "50",
        tradeDate: daysAgo(200),
      }),
    });

    const after = (await (
      await app.request("/performance?range=ALL&benchmarks=sp500", {
        headers: { cookie: cookieGhost },
      })
    ).json()) as PerformanceBody;

    // The unpriceable symbol contributes neither market value nor flows.
    expect(after.twr).toBe(before.twr);
    expect(after.anomalousDays).toBe(0);
    expect(after.indexSeries).toEqual(before.indexSeries);
  });
});

/** Consecutive daily bars whose returns alternate `up` then `down`, starting at
 *  100. Alternating keeps the series' variance non-zero and its drawdown
 *  non-zero, which the ratio blocks both need as denominators. */
function alternatingBars(days: number, up: number, down: number): PriceBar[] {
  const bars: PriceBar[] = [];
  let price = 100;
  for (let i = days; i >= 0; i--) {
    bars.push(bar(daysAgo(i), price.toFixed(6)));
    price *= i % 2 === 0 ? 1 + up : 1 + down;
  }
  return bars;
}

describeDb("GET /performance — benchmark-relative risk", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    // The holding moves exactly twice as hard as the benchmark on every single
    // day, which pins beta and the volatility ratio at 2 rather than leaving
    // them to whatever a random series happens to produce.
    const provider = new FakeMarketDataProvider({
      history: {
        AAPL: alternatingBars(40, 0.02, -0.012),
        "GSPC.INDX": alternatingBars(40, 0.01, -0.006),
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "perf-relative@test.com");

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
        quantity: "1",
        price: "100",
        tradeDate: daysAgo(40),
      }),
    });
  }, 90_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("reports beta once enough days overlap", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    const rel = ((await res.json()) as PerformanceBody).relative!;
    expect(rel.pairedDays).toBeGreaterThanOrEqual(rel.minPairedDaysForBeta);
    expect(rel.beta).toBeCloseTo(2, 4);
  });

  it("pairs each risk figure with the benchmark's own and their ratio", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    const rel = ((await res.json()) as PerformanceBody).relative!;
    expect(rel.volatility).not.toBeNull();
    expect(rel.volatility!.ratio).toBeCloseTo(rel.volatility!.value / rel.volatility!.benchmark, 5);
    // Twice the daily moves is twice the standard deviation.
    expect(rel.volatility!.ratio).toBeCloseTo(2, 3);

    expect(rel.maxDrawdown).not.toBeNull();
    expect(rel.maxDrawdown!.ratio).toBeCloseTo(
      rel.maxDrawdown!.value / rel.maxDrawdown!.benchmark,
      5,
    );
  });

  it("measures against the requested benchmark, not whichever fetch won the race", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500,msci-world", {
      headers: { cookie },
    });
    const body = (await res.json()) as PerformanceBody;
    // msci-world has no bars in this fixture, so only sp500 resolves — but the
    // assertion matters because arrival order is not request order.
    expect(body.relative!.benchmarkId).toBe("sp500");
  });
});

/** Flat daily bars from `startDaysAgo` through yesterday, all at `close`. */
function flatBars(startDaysAgo: number, close: string): PriceBar[] {
  const bars: PriceBar[] = [];
  for (let i = startDaysAgo; i >= 1; i--) bars.push(bar(daysAgo(i), close));
  return bars;
}

describeDb("GET /performance — a holding whose price history starts mid-window", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    // STEADY is priceable for the whole window and never moves, so every
    // honest daily return in this fixture is exactly zero.
    //
    // LATEBARS is held from the same day but has no bars until day 10 — the
    // shape a custom holding (marked every calendar day, holidays included)
    // creates for every real instrument at a window that opens on a market
    // holiday. It carries a large unrealised gain: bought at 50, worth 500.
    // When it joins the series its market value and its ORIGINAL COST arrive
    // together, and the daily-return formula nets only the cost — so its whole
    // multi-year gain lands in that one day unless the series accounts for it.
    const provider = new FakeMarketDataProvider({
      history: {
        STEADY: flatBars(40, "100"),
        LATEBARS: flatBars(10, "500"),
        "GSPC.INDX": flatBars(40, "100"),
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "perf-lateentry@test.com");

    for (const [symbol, price] of [
      ["STEADY", "100"],
      ["LATEBARS", "50"],
    ] as const) {
      await app.request("/transactions", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          instrument: {
            symbol,
            name: symbol,
            exchange: "NMS",
            currency: "USD",
            assetType: "stock",
          },
          type: "buy",
          quantity: "10",
          price,
          tradeDate: daysAgo(40),
        }),
      });
    }
  }, 90_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("does not book a late-priced holding's unrealised gain as one day's return", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    const body = (await res.json()) as PerformanceBody;
    // Nothing in this fixture ever changes price, so no day moved the needle.
    // Before the fix this was ~+450%: (6000 − 500) / 1000 − 1.
    expect(body.bestDay!.value).toBeCloseTo(0, 6);
    expect(body.worstDay!.value).toBeCloseTo(0, 6);
  });

  it("reports a flat portfolio as flat", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    const body = (await res.json()) as PerformanceBody;
    expect(body.twr).toBeCloseTo(0, 6);
    expect(body.volatility).toBeCloseTo(0, 6);
    expect(body.maxDrawdown).toBeCloseTo(0, 6);
  });
});

/**
 * `/performance` is the only route that sets `repairHistory: true` — this is
 * its end-to-end coverage. Exercised against a real `PersistedPriceProvider`
 * over `PriceStore`, not `FakeMarketDataProvider` directly, because the
 * repair attempt (and its failure here) lives in the store's coverage check —
 * a bare fake would "fetch" successfully no matter what the route asked for.
 */
describeDb("GET /performance — repairing short history through the route", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  const BUY = daysAgo(60);
  // The store's only bars for AAPL start well after BUY — the gap
  // `historyIncomplete` exists to catch, and exactly what a repair attempt
  // would need to backfill.
  const STORED_BAR_START = daysAgo(10);
  const TODAY = daysAgo(0);

  /** Upstream that always fails, standing in for a live outage during the
   *  repair attempt `/performance` pays for. */
  class FailingProvider implements IMarketDataProvider {
    getHistoricalPrices(): Promise<PriceBar[]> {
      return Promise.reject(new Error("upstream unavailable"));
    }
    getQuote(): Promise<Quote> {
      return Promise.reject(new Error("upstream unavailable"));
    }
    getDividendHistory(): Promise<Dividend[]> {
      return Promise.resolve([]);
    }
    searchSymbol(): Promise<SearchResult[]> {
      return Promise.resolve([]);
    }
    getAssetProfile(): Promise<AssetProfile> {
      return Promise.reject(new Error("upstream unavailable"));
    }
  }

  beforeAll(async () => {
    tdb = await withTestDb();

    const store = new PriceStore(tdb.db);
    await store.writeBars("AAPL", [bar(STORED_BAR_START, "100"), bar(TODAY, "121")], new Date());
    // A fully-priced neighbour, held from the same buy date. Without one the
    // series would simply start at STORED_BAR_START and there would be no date
    // it can value on which AAPL is held-but-unpriced — a single-holding book
    // cannot tell "this holding has no price" from "the market was shut".
    await store.writeBars(
      "ANCHRC",
      [bar(BUY, "50"), bar(daysAgo(30), "50"), bar(TODAY, "50")],
      new Date(),
    );

    const provider = new PersistedPriceProvider(store, new FailingProvider());
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "perf-repair-fails@test.com");

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
        price: "100",
        tradeDate: BUY,
      }),
    });

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: {
          symbol: "ANCHRC",
          name: "Anchor Co",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "50",
        tradeDate: BUY,
      }),
    });
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  // Mirrors `valuation-series.integration.test.ts`'s repair suite: reset the
  // module-level attempt throttle before each test and drain any
  // fire-and-forget refresh before the next test resets it out from under it.
  beforeEach(() => {
    resetPriceAttemptsForTests();
  });
  afterEach(async () => {
    await drainPriceRefreshesForTests();
  });

  it("publishes historyIncomplete and still returns a degraded, non-null TWR", async () => {
    const res = await app.request("/performance?range=ALL", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PerformanceBody;

    expect(body.historyIncomplete).toEqual(["AAPL"]);
    // The repair attempt failed upstream, but the route still values the
    // window the store DOES cover — the figure degrades, it does not
    // disappear.
    expect(body.twr).not.toBeNull();
  });
});

/**
 * A benchmark must be measured over the window the PORTFOLIO was measured over.
 * Anchoring it to its own earliest bar compared two different periods whenever
 * the two series did not start together, and the "gap in percentage points" the
 * UI prints was then a difference between a longer index run and a shorter
 * portfolio one.
 */
describeDb("GET /performance — benchmark aligned to the portfolio's window", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  // Bought at day -60, so the fetch window opens there — but this holding has
  // no bars until day -30, so the PORTFOLIO's first valued day is day -30 while
  // the index has bars from day -60 inside the very same fetched window. That
  // is the only shape where the two anchors differ; without it the provider
  // filters the early index bar out before the code under test ever sees it,
  // and the test passes either way.
  const BUY = daysAgo(60);
  const FIRST_VALUED = daysAgo(30);

  beforeAll(async () => {
    tdb = await withTestDb();

    // The index doubles BEFORE the portfolio exists, then is flat for the whole
    // period the portfolio is actually measured over. Anchored to its own first
    // bar it reports +100%; anchored to the portfolio's window, 0%.
    const provider = new FakeMarketDataProvider({
      history: {
        AAPL: [bar(FIRST_VALUED, "100"), bar(daysAgo(15), "100"), bar(daysAgo(0), "100")],
        "GSPC.INDX": [
          bar(BUY, "1000"),
          bar(FIRST_VALUED, "2000"),
          bar(daysAgo(15), "2000"),
          bar(daysAgo(0), "2000"),
        ],
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "perf-bm-align@test.com");

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
        quantity: "1",
        price: "100",
        tradeDate: BUY,
      }),
    });
  }, 90_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("ignores index movement from before the portfolio's first valued day", async () => {
    const res = await app.request("/performance?range=ALL&benchmarks=sp500", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { benchmarks: { id: string; twr: number }[] };

    const sp = body.benchmarks.find((b) => b.id === "sp500");
    expect(sp).toBeDefined();
    // 0, not 1: the doubling happened before this portfolio held anything.
    expect(sp!.twr).toBeCloseTo(0, 6);
  });
});
