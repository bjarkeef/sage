import { it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { Money, Decimal } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { fxRateDaily, priceDaily, user, portfolio, instrument, transaction } from "../db/schema";
import { EcbFxRateService } from "../market-data/ecb-fx-rate-service";
import { STALE_AFTER_DAYS } from "../market-data/fx-provenance";
import { PriceStore } from "../market-data/price-store";
import {
  PersistedPriceProvider,
  resetPriceAttemptsForTests,
  drainPriceRefreshesForTests,
} from "../market-data/persisted-price-provider";
import { buildValuationSeries } from "./valuation-series";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function bar(date: string, close: string, ccy = "USD"): PriceBar {
  const p = Money.of(close, ccy);
  return { date: new Date(date), open: p, high: p, low: p, close: p, volume: new Decimal(1000) };
}

describeDb("portfolio history — historical FX", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  const BUY = daysAgo(41);
  const OLD = daysAgo(40);
  const RECENT = daysAgo(5);

  beforeAll(async () => {
    tdb = await withTestDb();

    // ECB rows: USD per 1 EUR. The rate moves materially between the two dates,
    // so any EUR difference in the series comes purely from FX.
    await tdb.db.insert(fxRateDaily).values([
      { date: BUY, currency: "USD", rate: "1.0300" },
      { date: RECENT, currency: "USD", rate: "1.1500" },
    ]);

    // Identical $100 closes on both dates: the USD value never moves.
    const provider = new FakeMarketDataProvider({
      history: { AAPL: [bar(OLD, "100"), bar(RECENT, "100")] },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth, undefined, new EcbFxRateService(tdb.db));
    cookie = await signUpTestUser(app, "histfx@test.com");

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
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("values each date at that date's rate, not today's", async () => {
    const res = await app.request("/portfolio/history?range=ALL&currency=EUR", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      points: {
        date: string;
        value: { amount: string; currency: string };
        invested: { amount: string; currency: string };
      }[];
    };

    const first = body.points.find((p) => p.date === OLD)!;
    const last = body.points.find((p) => p.date === RECENT)!;

    // 10 shares × $100 = $1000.
    //   OLD    → forward-fills BUY's 1.0300 → 970.87 EUR
    //   RECENT → 1.1500                     → 869.57 EUR
    // Converting the whole series at today's rate (the behaviour being
    // replaced) reports 869.57 on BOTH dates, so this fails before the fix.
    expect(first.value.amount).toBe("970.87");
    expect(last.value.amount).toBe("869.57");
    expect(first.value.currency).toBe("EUR");
  });

  it("holds cost basis at the rate of the date it was paid", async () => {
    const res = await app.request("/portfolio/history?range=ALL&currency=EUR", {
      headers: { cookie },
    });
    const body = (await res.json()) as {
      points: { date: string; invested: { amount: string } }[];
    };

    // $1000 invested on BUY at 1.0300 stays 970.87 EUR for the whole series —
    // a past purchase does not get cheaper because EUR/USD moved since.
    expect(body.points.find((p) => p.date === OLD)!.invested.amount).toBe("970.87");
    expect(body.points.find((p) => p.date === RECENT)!.invested.amount).toBe("970.87");
  });

  it("prices a flow older than the requested range at its own rate", async () => {
    // A 1W chart still has to convert a buy from 41 days ago at THAT day's
    // rate: cost basis is cumulative over every flow ever made, so anchoring
    // the rate window to the display range would report a different invested
    // line per range. Nothing here is approximated, so the flag stays false.
    const res = await app.request("/portfolio/history?range=1W&currency=EUR", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      points: { date: string; value: { amount: string }; invested: { amount: string } }[];
      fxApproximated: boolean;
    };

    const point = body.points.find((p) => p.date === RECENT)!;
    expect(point.invested.amount).toBe("970.87");
    expect(point.value.amount).toBe("869.57");
    expect(body.fxApproximated).toBe(false);
  });
});

/**
 * The degradation signals the spec's table promises, on the two endpoints this
 * branch rewrote. `fxApproximated` alone is not enough: rates can be complete
 * but weeks old (`fxStale`), or missing entirely for a currency ECB does not
 * publish (`fxIncomplete`), and both change what the chart means.
 */
describeDb("portfolio history / performance — FX degradation signals", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  /** Holds AAPL, quoted and bought in USD — a currency ECB publishes. */
  let usdCookie: string;
  /** Holds a symbol quoted in USD but BOUGHT in INR, which ECB does not
   *  publish: market value survives, the whole cost line does not. */
  let inrCookie: string;

  const BUY = daysAgo(40);
  const MID = daysAgo(20);
  const RECENT = daysAgo(3);

  /**
   * Replaces `fx_rate_daily` with ONE publication day, `age` days back.
   * Relative on purpose: an absolute date stops exercising the staleness
   * branch the moment it drifts past the threshold.
   */
  async function seedRates(age: number) {
    await tdb.db.delete(fxRateDaily);
    await tdb.db.insert(fxRateDaily).values({
      date: daysAgo(age),
      currency: "USD",
      rate: "1.1500",
    });
  }

  interface HistoryBody {
    points: { date: string; value: { amount: string }; invested: { amount: string } }[];
    fxApproximated: boolean;
    fxIncomplete: boolean;
    fxStale: boolean;
    fxRatesAsOf: string | null;
  }

  interface PerformanceBody {
    insufficientData: boolean;
    fxApproximated: boolean;
    fxIncomplete: boolean;
    fxStale: boolean;
    fxRatesAsOf: string | null;
  }

  async function getHistory(cookie: string): Promise<HistoryBody> {
    const res = await app.request("/portfolio/history?range=ALL&currency=EUR", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as HistoryBody;
  }

  async function getPerformance(cookie: string): Promise<PerformanceBody> {
    const res = await app.request("/performance?range=ALL&currency=EUR", { headers: { cookie } });
    expect(res.status).toBe(200);
    return (await res.json()) as PerformanceBody;
  }

  async function buy(cookie: string, symbol: string, currency: string) {
    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: { symbol, name: symbol, exchange: "NMS", currency, assetType: "stock" },
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: BUY,
      }),
    });
  }

  beforeAll(async () => {
    tdb = await withTestDb();
    const provider = new FakeMarketDataProvider({
      history: {
        AAPL: [bar(MID, "100"), bar(RECENT, "110")],
        // Quoted in USD even though every trade was priced in INR.
        INFY: [bar(MID, "100"), bar(RECENT, "110")],
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth, undefined, new EcbFxRateService(tdb.db));

    usdCookie = await signUpTestUser(app, "fxsignals-usd@test.com");
    inrCookie = await signUpTestUser(app, "fxsignals-inr@test.com");
    await buy(usdCookie, "AAPL", "USD");
    await buy(inrCookie, "INFY", "INR");
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("reports neither staleness nor incompleteness on fresh, complete rates", async () => {
    await seedRates(0);
    const body = await getHistory(usdCookie);
    expect(body.fxStale).toBe(false);
    expect(body.fxIncomplete).toBe(false);
    expect(body.fxRatesAsOf).toBe(daysAgo(0));
  });

  it("flags fxStale on the chart, with the day the rates came from", async () => {
    await seedRates(STALE_AFTER_DAYS + 3);
    const body = await getHistory(usdCookie);
    expect(body.fxStale).toBe(true);
    expect(body.fxRatesAsOf).toBe(daysAgo(STALE_AFTER_DAYS + 3));
    // A stale rate still prices USD: the chart is old-rate, not missing.
    expect(body.fxIncomplete).toBe(false);
    expect(body.points.length).toBeGreaterThan(0);
  });

  it("does not flag fxStale over a weekend-sized gap", async () => {
    await seedRates(3);
    expect((await getHistory(usdCookie)).fxStale).toBe(false);
  });

  it("flags fxStale on the performance metrics too", async () => {
    await seedRates(STALE_AFTER_DAYS + 3);
    const body = await getPerformance(usdCookie);
    expect(body.fxStale).toBe(true);
    expect(body.fxRatesAsOf).toBe(daysAgo(STALE_AFTER_DAYS + 3));
  });

  it("flags fxIncomplete when a trade currency ECB does not publish is dropped", async () => {
    await seedRates(0);
    const body = await getHistory(inrCookie);
    expect(body.fxIncomplete).toBe(true);

    // The sharp edge this flag exists for: the USD-quoted bars still convert,
    // so market value is intact, while every INR-priced flow leaves the cost
    // line -- a phantom gain of the entire position. Unflagged, the chart just
    // looks like a very good investment.
    const point = body.points.find((p) => p.date === RECENT)!;
    expect(Number(point.value.amount)).toBeGreaterThan(0);
    expect(Number(point.invested.amount)).toBe(0);
  });

  it("flags fxIncomplete on the performance metrics too", async () => {
    await seedRates(0);
    expect((await getPerformance(inrCookie)).fxIncomplete).toBe(true);
  });

  it("does not flag fxIncomplete for a book whose currencies all price", async () => {
    await seedRates(0);
    expect((await getPerformance(usdCookie)).fxIncomplete).toBe(false);
  });
});

describeDb("portfolio history — split-adjusted price history", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let adjustedCookie: string;
  let cleanCookie: string;

  const BUY = daysAgo(40);
  const MID = daysAgo(30);
  const SPLIT = daysAgo(20);
  const RECENT = daysAgo(5);

  beforeAll(async () => {
    tdb = await withTestDb();

    // ADJUSTCO: bought 100 shares at $5, then a 1-for-10 reverse split. The
    // provider back-adjusted the whole history to the post-split basis, so every
    // bar reads $50 — including dates before the split happened. True value
    // throughout is 100 x $5 = $500.
    //
    // CLEANCO: no split anywhere. Flat $100 bars, 10 shares, so every point is
    // exactly $1000. Its expectation is arithmetic rather than a snapshot of a
    // previous run, so it cannot enshrine a bug the way captured output would.
    const provider = new FakeMarketDataProvider({
      history: {
        ADJUSTCO: [bar(BUY, "50"), bar(MID, "50"), bar(SPLIT, "50"), bar(RECENT, "50")],
        CLEANCO: [bar(BUY, "100"), bar(MID, "100"), bar(SPLIT, "100"), bar(RECENT, "100")],
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    adjustedCookie = await signUpTestUser(app, "splitadj@test.com");
    cleanCookie = await signUpTestUser(app, "splitclean@test.com");

    const post = async (cookie: string, body: unknown) =>
      app.request("/transactions", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });

    const instrumentOf = (symbol: string) => ({
      symbol,
      name: symbol,
      exchange: "NMS",
      currency: "USD",
      assetType: "stock",
    });

    await post(adjustedCookie, {
      instrument: instrumentOf("ADJUSTCO"),
      type: "buy",
      quantity: "100",
      price: "5",
      tradeDate: BUY,
    });
    await post(adjustedCookie, {
      instrument: instrumentOf("ADJUSTCO"),
      type: "split",
      quantity: "0.1",
      price: "0",
      tradeDate: SPLIT,
    });

    await post(cleanCookie, {
      instrument: instrumentOf("CLEANCO"),
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: BUY,
    });

    // The detector reads stored bars, not the provider, so a trade date needs a
    // `price_daily` row to be checkable at all. Without these ADJUSTCO would be
    // `unverified` and — correctly — left uncorrected.
    const storedBar = (symbol: string, date: string, close: string) => ({
      symbol,
      date,
      open: close,
      high: close,
      low: close,
      close,
      volume: "0",
      currency: "USD",
    });
    await tdb.db
      .insert(priceDaily)
      .values([storedBar("ADJUSTCO", BUY, "50"), storedBar("CLEANCO", BUY, "100")])
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  async function history(cookie: string) {
    const res = await app.request("/portfolio/history?range=ALL", { headers: { cookie } });
    return (await res.json()) as { points: { date: string; value: { amount: string } }[] };
  }

  it("values a back-adjusted holding on the ledger's own basis", async () => {
    const body = await history(adjustedCookie);
    expect(body.points.length).toBeGreaterThan(1);
    // Uncorrected, the pre-split points read 100 x $50 = $5000.
    for (const p of body.points) {
      expect(Number(p.value.amount)).toBeCloseTo(500, 0);
    }
  });

  it("leaves a book with no splits exactly where it was", async () => {
    const body = await history(cleanCookie);
    expect(body.points.length).toBeGreaterThan(1);
    for (const p of body.points) {
      expect(Number(p.value.amount)).toBeCloseTo(1000, 6);
    }
  });

  it("does not manufacture a return on the day the correction applies", async () => {
    const res = await app.request("/performance?range=ALL", {
      headers: { cookie: adjustedCookie },
    });
    const body = (await res.json()) as {
      bestDay: { value: number } | null;
      worstDay: { value: number } | null;
      twr: number | null;
    };
    // Nothing moved: the price is flat and the split is a unit change, not a
    // gain. Before the correction the split date booked a −90% day.
    expect(body.twr ?? 0).toBeCloseTo(0, 6);
    if (body.bestDay) expect(body.bestDay.value).toBeCloseTo(0, 6);
    if (body.worstDay) expect(body.worstDay.value).toBeCloseTo(0, 6);
  });
});

/**
 * `historyIncomplete` names a holding whose stored bars start after it was
 * bought: it enters the series mid-window and is charged in at market value,
 * so its whole accumulated gain lands as one day's return. Task 4 repairs
 * this; here the series only has to detect and report it.
 */
describeDb("portfolio history — short history detection", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let provider: FakeMarketDataProvider;
  let lateUserId: string;
  let onTimeUserId: string;
  let holidayUserId: string;
  let soloUserId: string;

  // LATE: bought well before the range, but the store's earliest bar for it
  // is much more recent -- the gap `historyIncomplete` exists to catch.
  const LATE_BUY = daysAgo(60);
  const LATE_BAR_START = daysAgo(10);
  const LATE_BAR_NEXT = daysAgo(9);
  // The late user also holds a fully-priced neighbour. Without one the series
  // would simply START at day -10 and there would be no date it can value on
  // which AAPL is held-but-unpriced — a one-holding book cannot distinguish
  // "this holding has no price" from "the market was shut".
  const LATE_ANCHOR_BUY = daysAgo(60);
  // A mid-window bar: the anchor must price a date BETWEEN the window start
  // and AAPL's first bar, or there is no point on which AAPL is held-but-
  // unpriced (the window start itself is exempt — see valuation-series.ts).
  const LATE_ANCHOR_MID = daysAgo(30);

  // The on-time user holds TWO symbols so windowStart and firstTrade
  // genuinely differ, which is what exercises `max()` at valuation-series.ts.
  // ANCHOR sets portfolio inception (and so windowStart, on an ALL range)
  // 60 days back, with full history from that same day -- not short.
  // ON_TIME is bought 50 days later, with its own bars starting the day it
  // was bought. If `max(firstTrade, windowStart)` were replaced by bare
  // `windowStart`, ON_TIME's required date would wrongly be pushed back to
  // ANCHOR_BUY, and its bars (starting 50 days after that) would falsely
  // read as a gap.
  const ANCHOR_BUY = daysAgo(60);
  const ANCHOR_BAR_NEXT = daysAgo(9);
  const ON_TIME_BUY = daysAgo(10);
  const ON_TIME_BAR_NEXT = daysAgo(9);

  // HOLIDAY: the window start is a CALENDAR date but bars only exist on
  // TRADING days. On a 1Y range the window opens exactly 365 days ago; if the
  // market was shut that day, NO symbol has a bar on it. Bought well before
  // the window with continuous bars that simply start a day inside it -- so
  // nothing is missing, the market was just closed.
  // SOLO: the only holding, bought long before its bars begin. Nothing else is
  // priced, so NO point falls inside the gap and the in-loop check can never
  // see it -- the series just starts late. This is the cold-store shape the
  // whole flag exists for, and only the truncation arm catches it.
  const SOLO_BUY = daysAgo(90);
  const SOLO_BAR_START = daysAgo(20);

  const HOLIDAY_BUY = daysAgo(400);
  const HOLIDAY_BAR_START = daysAgo(364);
  const HOLIDAY_BAR_NEXT = daysAgo(363);

  async function userIdFor(email: string): Promise<string> {
    const [row] = await tdb.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    if (!row) throw new Error(`test user not found after sign-up: ${email}`);
    return row.id;
  }

  beforeAll(async () => {
    tdb = await withTestDb();
    provider = new FakeMarketDataProvider({
      history: {
        AAPL: [bar(LATE_BAR_START, "100"), bar(LATE_BAR_NEXT, "100")],
        ANCHRC: [bar(LATE_ANCHOR_BUY, "50"), bar(LATE_ANCHOR_MID, "50"), bar(LATE_BAR_NEXT, "50")],
        KO: [bar(ANCHOR_BUY, "100"), bar(ANCHOR_BAR_NEXT, "100")],
        MSFT: [bar(ON_TIME_BUY, "100"), bar(ON_TIME_BAR_NEXT, "100")],
        SHUTCO: [bar(HOLIDAY_BAR_START, "100"), bar(HOLIDAY_BAR_NEXT, "110")],
        SOLOCO: [bar(SOLO_BAR_START, "100"), bar(daysAgo(19), "110")],
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);

    const lateCookie = await signUpTestUser(app, "history-late@test.com");
    const onTimeCookie = await signUpTestUser(app, "history-ontime@test.com");
    lateUserId = await userIdFor("history-late@test.com");
    onTimeUserId = await userIdFor("history-ontime@test.com");
    const holidayCookie = await signUpTestUser(app, "history-holiday@test.com");
    holidayUserId = await userIdFor("history-holiday@test.com");
    const soloCookie = await signUpTestUser(app, "history-solo@test.com");
    soloUserId = await userIdFor("history-solo@test.com");

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: lateCookie },
      body: JSON.stringify({
        instrument: {
          symbol: "AAPL",
          name: "AAPL",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: LATE_BUY,
      }),
    });

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: lateCookie },
      body: JSON.stringify({
        instrument: {
          symbol: "ANCHRC",
          name: "ANCHRC",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "50",
        tradeDate: LATE_ANCHOR_BUY,
      }),
    });

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: onTimeCookie },
      body: JSON.stringify({
        instrument: {
          symbol: "KO",
          name: "KO",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: ANCHOR_BUY,
      }),
    });

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: onTimeCookie },
      body: JSON.stringify({
        instrument: {
          symbol: "MSFT",
          name: "MSFT",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: ON_TIME_BUY,
      }),
    });

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: holidayCookie },
      body: JSON.stringify({
        instrument: {
          symbol: "SHUTCO",
          name: "SHUTCO",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: HOLIDAY_BUY,
      }),
    });

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: soloCookie },
      body: JSON.stringify({
        instrument: {
          symbol: "SOLOCO",
          name: "SOLOCO",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: SOLO_BUY,
      }),
    });
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("names a holding whose stored history starts after it was bought", async () => {
    const series = await buildValuationSeries({ db: tdb.db, provider }, lateUserId, {
      range: "ALL",
    });
    if ("empty" in series) throw new Error("expected a non-empty series");
    expect(series.historyIncomplete).toEqual(["AAPL"]);
  });

  it("does not name a holding bought after the window opened, even when an earlier holding set the window start", async () => {
    // ANCHOR (KO) sets inception 60 days back with full history -- not
    // short. ON_TIME (MSFT) is bought 50 days later than that, with bars
    // starting the same day it was bought. windowStart (day -60) and
    // MSFT's own firstTrade (day -10) genuinely differ here, so this only
    // passes if the comparison uses `max(firstTrade, windowStart)` rather
    // than bare `windowStart`.
    const series = await buildValuationSeries({ db: tdb.db, provider }, onTimeUserId, {
      range: "ALL",
    });
    if ("empty" in series) throw new Error("expected a non-empty series");
    expect(series.historyIncomplete).toEqual([]);
  });

  it("does not name every holding when the window opens on a day the market was shut", async () => {
    // The regression this guards: `windowStart` is a calendar date, bars are
    // trading days. On a 1Y range the window opens 365 days ago; nobody has a
    // bar for that day if it was a weekend or a holiday, so comparing against
    // the raw window start flagged the WHOLE book. YTD made it certain --
    // 1 January is a holiday everywhere, and YTD is the range the overview
    // publishes, so every user would have seen the front page call its own
    // figure incomplete every day of the year.
    //
    // The floor is therefore the earliest bar the book actually has in the
    // window: no holding can be expected to predate the first open day.
    const series = await buildValuationSeries({ db: tdb.db, provider }, holidayUserId, {
      range: "1Y",
    });
    if ("empty" in series) throw new Error("expected a non-empty series");
    expect(series.historyIncomplete).toEqual([]);
  });

  it("names a lone holding whose series simply starts late", async () => {
    // No priced neighbour, so no point falls inside the gap and the in-loop
    // check cannot fire. Without the truncation arm the series silently starts
    // 70 days late and reports nothing -- an ALL range covering a fraction of
    // the holding period, with no marker. This is the cold-store case the flag
    // exists for.
    const series = await buildValuationSeries({ db: tdb.db, provider }, soloUserId, {
      range: "ALL",
    });
    if ("empty" in series) throw new Error("expected a non-empty series");
    expect(series.historyIncomplete).toEqual(["SOLOCO"]);
  });
});

/**
 * A window opens on a CALENDAR date; bars fall on TRADING days. The first day
 * inside a range is therefore routinely a day nothing traded — YTD opens on
 * 1 January every year, 1W opens on whatever weekday today is, 3M lands on a
 * weekend one time in three.
 *
 * Reported against a real book: the YTD chart's first point read 12,779 where
 * the day before and the day after both read ~38,000, because the only thing
 * priceable on 1 January was a custom holding, whose provider re-dates its last
 * mark to the window start so it never vanishes from a chart. The
 * money-weighted return takes that first point as the opening balance and
 * reported 52% for the year against a time-weighted 8.7%.
 */
describeDb("portfolio history — a window opening on a day nothing traded", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let provider: FakeMarketDataProvider;
  let userId: string;

  /** The 1Y window start, computed the way `rangeToDate` computes it rather
   *  than as "365 days ago" — one of the two is wrong in a leap year. */
  function utcKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
  const now = new Date();
  const WINDOW_START = utcKey(
    new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate())),
  );
  const DAY_BEFORE_WINDOW = utcKey(new Date(Date.parse(`${WINDOW_START}T00:00:00Z`) - 86_400_000));
  const DAY_AFTER_WINDOW = utcKey(new Date(Date.parse(`${WINDOW_START}T00:00:00Z`) + 86_400_000));
  const BUY = utcKey(new Date(Date.parse(`${WINDOW_START}T00:00:00Z`) - 30 * 86_400_000));
  const TODAY = utcKey(now);

  beforeAll(async () => {
    tdb = await withTestDb();
    provider = new FakeMarketDataProvider({
      history: {
        // Stands in for the custom holding: a mark ON the window start, so a
        // point is emitted for a date no exchange traded.
        MARKED: [bar(BUY, "50"), bar(WINDOW_START, "50"), bar(TODAY, "50")],
        // An ordinary listing: it has a close from the day before the window
        // opened, and nothing on the window start itself, because that day was
        // shut. It is held throughout.
        LISTED: [bar(BUY, "100"), bar(DAY_BEFORE_WINDOW, "100"), bar(DAY_AFTER_WINDOW, "100")],
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    const cookie = await signUpTestUser(app, "history-shut-open@test.com");
    const [row] = await tdb.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "history-shut-open@test.com"))
      .limit(1);
    if (!row) throw new Error("test user not found after sign-up");
    userId = row.id;

    for (const symbol of ["MARKED", "LISTED"]) {
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
          price: symbol === "MARKED" ? "50" : "100",
          tradeDate: BUY,
        }),
      });
    }
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("values the whole book on the first day, not only what happened to trade", async () => {
    const series = await buildValuationSeries({ db: tdb.db, provider }, userId, { range: "1Y" });
    if ("empty" in series) throw new Error("expected a non-empty series");

    const first = series.points[0];
    expect(first?.date).toBe(WINDOW_START);
    // MARKED 10 x 50 = 500, LISTED 10 x 100 = 1,000. Before the warm-up read,
    // LISTED had no bar at or after the window start and contributed nothing,
    // so this point was 500 — a third of the book, on the date every
    // money-weighted return takes as its opening balance.
    expect(first?.marketValue.toFixed(2)).toBe("1500.00");
  });

  it("does not disagree with itself about the same day across ranges", async () => {
    const short = await buildValuationSeries({ db: tdb.db, provider }, userId, { range: "1Y" });
    const long = await buildValuationSeries({ db: tdb.db, provider }, userId, { range: "ALL" });
    if ("empty" in short || "empty" in long) throw new Error("expected non-empty series");

    const fromLong = long.points.find((p) => p.date === WINDOW_START);
    expect(fromLong).toBeDefined();
    // The cost line drifted between ranges for exactly this reason: a symbol's
    // cost enters the series on the day its VALUE does, so a symbol missing
    // from day one of a short range was missing its cost there too.
    expect(short.points[0]?.marketValue.toFixed(2)).toBe(fromLong!.marketValue.toFixed(2));
    expect(short.points[0]?.invested.toFixed(2)).toBe(fromLong!.invested.toFixed(2));
  });
});

/**
 * The chart's last point and the portfolio's own total are the same holdings on
 * the same day. They were priced from two different fields — the daily close
 * and the quote — and on the reporting book that put 169,459.28 under the
 * overview hero and 168,864.01 in the card directly below it.
 */
describeDb("portfolio history — the newest point is priced like the portfolio", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let provider: FakeMarketDataProvider;
  let userId: string;

  const BUY = daysAgo(40);
  const LAST_BAR = daysAgo(1);

  beforeAll(async () => {
    tdb = await withTestDb();
    provider = new FakeMarketDataProvider({
      // Close of 100 on the last bar, but the quote for the same day says 110.
      history: { AAPL: [bar(BUY, "90"), bar(LAST_BAR, "100")] },
      quotes: {
        AAPL: {
          symbol: "AAPL",
          price: Money.of("110", "USD"),
          asOf: new Date(`${LAST_BAR}T00:00:00Z`),
          previousClose: Money.of("100", "USD"),
        },
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    const cookie = await signUpTestUser(app, "newest-point@test.com");
    const [row] = await tdb.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "newest-point@test.com"))
      .limit(1);
    if (!row) throw new Error("test user not found after sign-up");
    userId = row.id;
    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: {
          symbol: "AAPL",
          name: "AAPL",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "90",
        tradeDate: BUY,
      }),
    });
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("values the last point at the quote, and every earlier point at its close", async () => {
    const series = await buildValuationSeries({ db: tdb.db, provider }, userId, { range: "ALL" });
    if ("empty" in series) throw new Error("expected a non-empty series");

    const last = series.points[series.points.length - 1]!;
    expect(last.date).toBe(LAST_BAR);
    // 10 x 110 (quote), not 10 x 100 (close) — which is what `/portfolio`
    // reports for the same holdings on the same day.
    expect(last.marketValue.toFixed(2)).toBe("1100.00");

    const first = series.points[0]!;
    expect(first.date).toBe(BUY);
    // Untouched: only the newest point has a quote that is not older than it.
    expect(first.marketValue.toFixed(2)).toBe("900.00");
  });
});

/**
 * Forward-fill is how a holding survives a weekend. It was unbounded, so a
 * symbol whose bars stopped in August was still valued in September at August's
 * price, silently — on a real book, 18 of 27 holdings had no bar for three
 * weeks and the chart drew a confident line through all of it.
 */
describeDb("portfolio history — prices carried too far", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let provider: FakeMarketDataProvider;
  let userId: string;

  const BUY = daysAgo(120);
  const STOPPED = daysAgo(40); // last bar for the stale holding
  const TODAY = daysAgo(1);

  beforeAll(async () => {
    tdb = await withTestDb();
    provider = new FakeMarketDataProvider({
      history: {
        // Its bars stop 40 days ago; every later date carries that close.
        STALECO: [bar(BUY, "100"), bar(STOPPED, "100")],
        // Priced right through, so the series has dates to emit at all.
        FRESHCO: [bar(BUY, "50"), bar(STOPPED, "50"), bar(TODAY, "50")],
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    const cookie = await signUpTestUser(app, "stale-prices@test.com");
    const [row] = await tdb.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "stale-prices@test.com"))
      .limit(1);
    if (!row) throw new Error("test user not found after sign-up");
    userId = row.id;

    for (const [symbol, price] of [
      ["STALECO", "100"],
      ["FRESHCO", "50"],
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
          tradeDate: BUY,
        }),
      });
    }
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("names the holding whose price stopped, and the date it stopped", async () => {
    const series = await buildValuationSeries({ db: tdb.db, provider }, userId, { range: "ALL" });
    if ("empty" in series) throw new Error("expected a non-empty series");

    expect(series.stalePrices).toEqual([{ symbol: "STALECO", asOf: STOPPED, quotedToday: false }]);
  });

  /** The newest point is repriced from the quote, so a holding whose BARS
   *  stopped can still be valued at today's price. Saying it "is priced from"
   *  the old date would then be false about the figure on screen: only the
   *  chart behind it is old. */
  it("says when a holding with old bars is still valued at a current quote", async () => {
    const quoted = new FakeMarketDataProvider({
      history: {
        STALECO: [bar(BUY, "100"), bar(STOPPED, "100")],
        FRESHCO: [bar(BUY, "50"), bar(STOPPED, "50"), bar(TODAY, "50")],
      },
      quotes: {
        STALECO: {
          symbol: "STALECO",
          price: Money.of("120", "USD"),
          asOf: new Date(),
          previousClose: null,
        },
      },
    });

    const series = await buildValuationSeries({ db: tdb.db, provider: quoted }, userId, {
      range: "ALL",
    });
    if ("empty" in series) throw new Error("expected a non-empty series");

    expect(series.stalePrices).toEqual([{ symbol: "STALECO", asOf: STOPPED, quotedToday: true }]);
  });

  it("still counts it, because dropping it would draw a loss that did not happen", async () => {
    const series = await buildValuationSeries({ db: tdb.db, provider }, userId, { range: "ALL" });
    if ("empty" in series) throw new Error("expected a non-empty series");

    // 10 x 100 carried forward, plus 10 x 50 priced today. Silence was the
    // defect; removing the holding would have been a worse answer than a stale
    // price, since the book did not lose it.
    const last = series.points[series.points.length - 1]!;
    expect(last.marketValue.toFixed(2)).toBe("1500.00");
    // And it is NOT reported as unpriceable — it has a price, just an old one.
    expect(series.historyIncomplete).not.toContain("STALECO");
  });

  it("says nothing about a holding priced right up to the last day", async () => {
    const series = await buildValuationSeries({ db: tdb.db, provider }, userId, { range: "ALL" });
    if ("empty" in series) throw new Error("expected a non-empty series");
    expect(series.stalePrices.map((p) => p.symbol)).not.toContain("FRESHCO");
  });
});

/**
 * Task 4: `repairHistory` turns detection (Task 3) into a repair, but ONLY
 * when the caller asks and ONLY for a symbol actually short — the guard
 * against this slowing down every ordinary page load. Exercised against a
 * real `PersistedPriceProvider` over `PriceStore`, not `FakeMarketDataProvider`
 * directly, because the short-circuit lives in the store's coverage check —
 * a bare fake would "fetch" successfully no matter what `requireFrom` says.
 */
describeDb("portfolio history — repairing short history", () => {
  let tdb: TestDb;

  /** Upstream stub with a call counter, standing in for EODHD/Yahoo. */
  class CountingProvider implements IMarketDataProvider {
    bars: Record<string, PriceBar[]> = {};
    historyCalls = 0;
    getHistoricalPrices(symbol: string): Promise<PriceBar[]> {
      this.historyCalls += 1;
      return Promise.resolve(this.bars[symbol] ?? []);
    }
    getQuote(): Promise<Quote> {
      return Promise.reject(new Error("not used"));
    }
    getDividendHistory(): Promise<Dividend[]> {
      return Promise.resolve([]);
    }
    searchSymbol(): Promise<SearchResult[]> {
      return Promise.resolve([]);
    }
    getAssetProfile(): Promise<AssetProfile> {
      return Promise.reject(new Error("not used"));
    }
  }

  const BUY = daysAgo(40);
  const TODAY = daysAgo(0);

  let userSeq = 0;
  /** Inserts a user/portfolio/instrument/single-buy directly — no HTTP layer
   *  needed, matching `portfolio-outage.integration.test.ts`. Returns the
   *  new user's id. */
  async function seedBuy(
    symbol: string,
    tradeDate: string,
    /** A second holding with complete bars. Without one the portfolio has a
     *  single symbol, and a series whose only symbol is unpriced early simply
     *  STARTS later — there is no date it can value on which that symbol is
     *  held-but-unpriced, and nothing to report. Real books have neighbours;
     *  a one-holding fixture tests a shape the flag is not about. */
    anchor?: { symbol: string; tradeDate: string },
  ): Promise<string> {
    userSeq += 1;
    const userId = `repair-user-${userSeq}`;
    await tdb.db.insert(user).values({
      id: userId,
      name: "Repair Test",
      email: `repair-${userSeq}@test.invalid`,
      emailVerified: true,
    });
    const [pf] = await tdb.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    await tdb.db
      .insert(instrument)
      .values({ symbol, name: symbol, exchange: "NMS", currency: "USD", assetType: "stock" })
      .onConflictDoNothing();
    await tdb.db.insert(transaction).values({
      portfolioId: pf!.id,
      instrumentSymbol: symbol,
      type: "buy",
      quantity: "10",
      price: "100",
      currency: "USD",
      tradeDate,
    });
    if (anchor) {
      await tdb.db
        .insert(instrument)
        .values({
          symbol: anchor.symbol,
          name: anchor.symbol,
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        })
        .onConflictDoNothing();
      await tdb.db.insert(transaction).values({
        portfolioId: pf!.id,
        instrumentSymbol: anchor.symbol,
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "USD",
        tradeDate: anchor.tradeDate,
      });
    }
    return userId;
  }

  beforeAll(async () => {
    tdb = await withTestDb();
  });

  afterAll(async () => {
    await tdb?.stop();
  });

  // Mirrors `persisted-price-provider.integration.test.ts`: reset the
  // module-level attempt throttle before each test and drain any
  // fire-and-forget refresh before the next test resets it out from under it.
  beforeEach(() => {
    resetPriceAttemptsForTests();
  });
  afterEach(async () => {
    await drainPriceRefreshesForTests();
  });

  // Each test uses its own symbol, never reused across tests in this block:
  // `price_daily` is a real, shared table across the whole `describeDb` (only
  // the user/portfolio/transaction rows are per-test), so two tests writing
  // the same symbol would see each other's bars.

  it("repairs short history when asked, and clears the flag", async () => {
    const userId = await seedBuy("AAPL", BUY);

    // Store is short: its only bar is recent, well after the buy.
    const store = new PriceStore(tdb.db);
    await store.writeBars("AAPL", [bar(TODAY, "100")], new Date());

    // Upstream has the full history, including the buy date.
    const upstream = new CountingProvider();
    upstream.bars.AAPL = [bar(BUY, "90"), bar(TODAY, "100")];
    const provider = new PersistedPriceProvider(store, upstream);

    const before = upstream.historyCalls;
    const series = await buildValuationSeries({ db: tdb.db, provider }, userId, {
      range: "ALL",
      repairHistory: true,
    });
    if ("empty" in series) throw new Error("expected a non-empty series");

    expect(series.historyIncomplete).toEqual([]);
    // The repair pass had to actually go upstream to fix it.
    expect(upstream.historyCalls).toBeGreaterThan(before);
  });

  it("makes no upstream call when nothing is short", async () => {
    const userId = await seedBuy("MSFT", BUY);

    // Store already covers the whole window, buy date through today.
    const store = new PriceStore(tdb.db);
    await store.writeBars("MSFT", [bar(BUY, "90"), bar(TODAY, "100")], new Date());

    const upstream = new CountingProvider();
    // If this were ever called, the test data would prove it: history the
    // repair path has no business needing.
    upstream.bars.MSFT = [bar(BUY, "1"), bar(TODAY, "1")];
    const provider = new PersistedPriceProvider(store, upstream);

    const before = upstream.historyCalls;
    await buildValuationSeries({ db: tdb.db, provider }, userId, {
      range: "ALL",
      repairHistory: true,
    });
    await drainPriceRefreshesForTests();

    expect(upstream.historyCalls).toBe(before);
  });

  it("leaves a symbol in historyIncomplete when repair is not requested", async () => {
    const userId = await seedBuy("KO", BUY, { symbol: "NEIGHBR", tradeDate: BUY });

    const store = new PriceStore(tdb.db);
    await store.writeBars("KO", [bar(TODAY, "100")], new Date());
    // The anchor is fully priced from the buy date, so the series HAS dates it
    // can value while KO is held and unpriceable — which is what makes KO's
    // gap visible rather than merely shortening the series.
    await store.writeBars(
      "NEIGHBR",
      [bar(BUY, "50"), bar(daysAgo(20), "50"), bar(TODAY, "50")],
      new Date(),
    );

    const upstream = new CountingProvider();
    upstream.bars.KO = [bar(BUY, "90"), bar(TODAY, "100")];
    upstream.bars.NEIGHBR = [bar(BUY, "50"), bar(daysAgo(20), "50"), bar(TODAY, "50")];
    const provider = new PersistedPriceProvider(store, upstream);

    const series = await buildValuationSeries({ db: tdb.db, provider }, userId, {
      range: "ALL",
      // repairHistory omitted entirely.
    });
    if ("empty" in series) throw new Error("expected a non-empty series");

    // Coverage is short here regardless: `PersistedPriceProvider` fires its
    // own background refresh whenever stored bars don't span the window,
    // independent of `repairHistory` (existing behaviour, not this task's
    // concern). What THIS task must not do without being asked is BLOCK on a
    // fetch to fix it -- which is exactly what leaves the symbol reported.
    expect(series.historyIncomplete).toEqual(["KO"]);
  });
});
