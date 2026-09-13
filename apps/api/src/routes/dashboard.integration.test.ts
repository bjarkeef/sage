import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Money, Decimal } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type {
  Quote,
  PriceBar,
  IMarketDataProvider,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { previousMarketDay, selectRecentDividends } from "./dashboard";
import { dividendHistory, assetProfile } from "../db/schema";
import { PriceStore } from "../market-data/price-store";
import {
  PersistedPriceProvider,
  resetPriceAttemptsForTests,
  drainPriceRefreshesForTests,
} from "../market-data/persisted-price-provider";
import { PRIMARY_BENCHMARK_ID } from "../services/performance-view";
import { BENCHMARKS } from "../services/valuation-series";

type RecentRow = Parameters<typeof selectRecentDividends>[0][number];

describe("previousMarketDay", () => {
  it("reaches back to Friday from a Monday", () => {
    expect(previousMarketDay("2026-07-13")).toBe("2026-07-10"); // Mon → Fri
  });

  it("reaches back one day mid-week", () => {
    expect(previousMarketDay("2026-07-15")).toBe("2026-07-14"); // Wed → Tue
    expect(previousMarketDay("2026-07-14")).toBe("2026-07-13"); // Tue → Mon
  });
});

describe("selectRecentDividends", () => {
  const row = (symbol: string, paymentDate: string | null): RecentRow =>
    ({ symbol, paymentDate }) as RecentRow;

  it("keeps the [previousMarketDay, today] window, sorts ascending, caps at 3", () => {
    const today = "2026-07-13"; // Monday — window opens Friday 2026-07-10
    const rows = [
      row("LATE", "2026-07-14"), // tomorrow — out
      row("D", "2026-07-13"), // in window, but 4th ascending — capped away
      row("A", "2026-07-10"), // window edge — in
      row("STALE", "2026-07-09"), // before Friday — out
      row("B", "2026-07-11"),
      row("C", "2026-07-12"),
      row("NOPAY", null),
    ];
    const selected = selectRecentDividends(rows, today);
    expect(selected.map((r) => r.symbol)).toEqual(["A", "B", "C"]); // ascending, capped at 3
  });
});

function instrumentOf(symbol: string) {
  return {
    symbol,
    name: `${symbol} Inc`,
    exchange: "XNAS",
    currency: "USD",
    assetType: "stock",
  };
}

function quote(symbol: string, price: string, previousClose: string): Quote {
  return {
    symbol,
    price: Money.of(price, "USD"),
    asOf: new Date(),
    previousClose: Money.of(previousClose, "USD"),
  };
}

async function post(app: ReturnType<typeof createApp>, body: unknown, cookie: string) {
  const res = await app.request("/transactions", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  if (res.status !== 201)
    throw new Error(`transaction post failed: ${res.status} ${await res.text()}`);
  return res;
}

// Five symbols with distinct sectors and market values (10 shares each, prices
// 100/200/300/400/500), plus one ETF (VOO, 10 shares @ 600) that buckets under
// "Funds" regardless of sector, so the allocation selector's top-4-plus-Other
// math has a deterministic, hand-checkable answer:
//   total = 21000; percents = AAPL 4.76, MSFT 9.52, NVDA 14.29, GOOGL 19.05,
//     TSLA 23.81, Funds(VOO) 28.57
//   top4 (desc) = Funds, TSLA, GOOGL, NVDA (sum 85.72) -> Other = 14.28 (== AAPL + MSFT)
const SYMBOLS = [
  { symbol: "AAPL", price: "100", sector: "Sector1" },
  { symbol: "MSFT", price: "200", sector: "Sector2" },
  { symbol: "NVDA", price: "300", sector: "Sector3" },
  { symbol: "GOOGL", price: "400", sector: "Sector4" },
  { symbol: "TSLA", price: "500", sector: "Sector5" },
];
const FUND_SYMBOL = { symbol: "VOO", price: "600" };

describeDb("GET /dashboard", () => {
  let tdb: TestDb;
  let cookie: string;
  let app: ReturnType<typeof createApp>;

  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date();
  // Always inside the current UTC month and never in the future.
  const currentMonthExDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  // Inside the v2 projection model's 12-month announced window. Sorted last among
  // upcoming fixtures (must be after both MSFT announced ex-dates below).
  const announcedEx = new Date(Date.now() + 130 * DAY).toISOString().slice(0, 10);
  const announcedPay = new Date(Date.now() + 150 * DAY).toISOString().slice(0, 10);

  // MSFT announced rows feed upcomingDividends: exDate far in the future so
  // they land in the "announced" bucket, same as AAPL's. paymentDate is a
  // realistic ~21-day ex->pay lag AFTER its own exDate — real provider data
  // never pays before its ex-date (0 of 2,283 dividend_history rows in
  // production violate payment_date >= ex_date), so both are placed the same
  // number of days beyond their exDate rather than in the past. That also
  // means neither payment falls inside recentDividends' [previousMarketDay,
  // today] window: a dividend that is still genuinely "announced" (future
  // exDate) can never simultaneously have already been paid.
  // Keep MSFT announced ex-dates more than 12 days apart so dedupeDividends
  // (SAME_PAYMENT_GAP_DAYS) does not collapse them into one synthetic payment.
  const recentEx = new Date(Date.now() + 80 * DAY).toISOString().slice(0, 10);
  const recentPay = new Date(Date.now() + 101 * DAY).toISOString().slice(0, 10);
  const oldEx = new Date(Date.now() + 100 * DAY).toISOString().slice(0, 10);
  const oldPay = new Date(Date.now() + 121 * DAY).toISOString().slice(0, 10);
  // AAPL announced must stay beyond both MSFT dates for stable sort order in
  // upcomingDividends (sorted by exDate ascending).
  // announcedEx is set above to +100d — bump so it remains last.

  beforeAll(async () => {
    tdb = await withTestDb();

    const quotes: Record<string, Quote> = {};
    for (const s of SYMBOLS) {
      const prevClose = (Number(s.price) - 1).toString();
      quotes[s.symbol] = quote(s.symbol, s.price, prevClose);
    }
    quotes[FUND_SYMBOL.symbol] = quote(
      FUND_SYMBOL.symbol,
      FUND_SYMBOL.price,
      (Number(FUND_SYMBOL.price) - 1).toString(),
    );
    const provider = new FakeMarketDataProvider({ quotes });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "dashboard@example.com");

    for (const s of SYMBOLS) {
      await post(
        app,
        {
          instrument: instrumentOf(s.symbol),
          type: "buy",
          quantity: "10",
          price: s.price,
          tradeDate: "2025-01-01",
        },
        cookie,
      );
      await tdb.db.insert(assetProfile).values({
        symbol: s.symbol,
        name: `${s.symbol} Inc`,
        exchange: "XNAS",
        currency: "USD",
        sector: s.sector,
      });
    }

    // Fund position: buckets under "Funds" in sector.plain (Task 4 finding —
    // previously untested). No asset_profile row needed; the instrument's
    // assetType alone is enough for buildDiversificationView's isFund check.
    await post(
      app,
      {
        instrument: {
          symbol: FUND_SYMBOL.symbol,
          name: `${FUND_SYMBOL.symbol} ETF`,
          exchange: "ARCX",
          currency: "USD",
          assetType: "etf",
        },
        type: "buy",
        quantity: "10",
        price: FUND_SYMBOL.price,
        tradeDate: "2025-01-01",
      },
      cookie,
    );

    // AAPL dividend history: one row in the current UTC month (retroactive,
    // feeds income.thisMonth) and one announced future row (feeds
    // upcomingDividends).
    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "AAPL",
        exDate: currentMonthExDate,
        amountPerShare: "0.25",
        currency: "USD",
        source: "test",
      },
      {
        symbol: "AAPL",
        exDate: announcedEx,
        paymentDate: announcedPay,
        paymentDateEstimated: false,
        amountPerShare: "0.30",
        currency: "USD",
        source: "test",
      },
    ]);

    // MSFT announced rows: both feed upcomingDividends; both have a
    // realistic future paymentDate (see the recentEx/recentPay comment
    // above), so neither feeds recentDividends or this month's totals.
    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "MSFT",
        exDate: recentEx,
        paymentDate: recentPay,
        paymentDateEstimated: false,
        amountPerShare: "0.40",
        currency: "USD",
        source: "test",
      },
      {
        symbol: "MSFT",
        exDate: oldEx,
        paymentDate: oldPay,
        paymentDateEstimated: false,
        amountPerShare: "0.50",
        currency: "USD",
        source: "test",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("aggregates positions, today change, income, upcoming dividends, allocation, and history", async () => {
    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      displayCurrency: string | null;
      positions: { symbol: string }[];
      subtotalsByCurrency: { currency: string }[];
      todayChange: { amount: { amount: string; currency: string }; percent: number } | null;
      income: {
        projectedTwelveMonth: { amount: string; currency: string } | null;
        trailingTwelveMonth: { amount: string; currency: string } | null;
        thisMonth: {
          received: { amount: string; currency: string };
          projected: { amount: string; currency: string };
        } | null;
      };
      upcomingDividends: {
        symbol: string;
        date: string;
        projected: boolean;
        dateEstimated: boolean;
      }[];
      recentDividends: { symbol: string; exDate: string; paymentDate: string | null }[];
      allocation: { label: string; percent: number }[];
      history: { points: unknown[]; changePercent: number; changeAmount: unknown };
    };

    // displayCurrency + positions/subtotals
    expect(body.displayCurrency).toBe("USD");
    expect(body.positions).toHaveLength(6);
    expect(new Set(body.positions.map((p) => p.symbol))).toEqual(
      new Set([...SYMBOLS.map((s) => s.symbol), FUND_SYMBOL.symbol]),
    );
    const usd = body.subtotalsByCurrency.find((s) => s.currency === "USD");
    expect(usd).toBeDefined();

    // todayChange: provider-derived, but every position is priced with a
    // previousClose in the same currency, so it must resolve non-null.
    expect(body.todayChange).not.toBeNull();
    expect(typeof body.todayChange!.percent).toBe("number");
    expect(body.todayChange!.amount.currency).toBe("USD");

    // income summary totals mirror /dividends/income's summary — verified
    // against a live call to the sibling endpoint, same pattern as history.
    const incomeRes = await app.request("/dividends/income?currency=USD", { headers: { cookie } });
    expect(incomeRes.status).toBe(200);
    const incomeBody = (await incomeRes.json()) as {
      summary: {
        trailingTwelveMonthIncome: { amount: string; currency: string }[];
        projectedTwelveMonthIncome: { amount: string; currency: string }[];
      };
    };
    expect(body.income.trailingTwelveMonth).toEqual(
      incomeBody.summary.trailingTwelveMonthIncome[0] ?? null,
    );
    expect(body.income.projectedTwelveMonth).toEqual(
      incomeBody.summary.projectedTwelveMonthIncome[0] ?? null,
    );
    expect(body.income.trailingTwelveMonth!.currency).toBe("USD");
    expect(body.income.projectedTwelveMonth!.currency).toBe("USD");

    // income.thisMonth: matches the current-month monthlyBreakdown row.
    // "received" comes from the ledger (fix/received-dividends-from-ledger):
    // dashboard triggers the same lazy auto-reconciliation as every other
    // dividend-relevant route, and `planAutoDividends` plans off `cashDate =
    // paymentDate ?? exDate`. AAPL's current-month row is the only seeded
    // dividend_history row with a cash date <= today (its exDate has no
    // paymentDate, so cashDate falls back to exDate, which is this month) —
    // both MSFT rows have a realistic future paymentDate (exDate + a ~21-day
    // ex->pay lag), so neither reconciles onto the ledger yet and neither
    // falls in the current month at all. So only AAPL's 10 shares * $0.25 =
    // $2.50 lands in "received", and nothing else is in this month's
    // "announced"/"projected" buckets, so "projected" (the full-month total)
    // is the same $2.50. Both MoneyDTO amounts are 2dp-normalized like every
    // other money in the DTO.
    expect(body.income.thisMonth).not.toBeNull();
    expect(body.income.thisMonth!.received).toEqual({ amount: "2.50", currency: "USD" });
    expect(body.income.thisMonth!.projected).toEqual({ amount: "2.50", currency: "USD" });

    // upcomingDividends: announced rows with exDate >= today, ascending, max 4.
    // AAPL's announcedEx (+130d) plus the two MSFT rows (+80d, +100d) all
    // qualify; ascending by exDate puts MSFT first.
    // upcomingDividends: Task 10 replaced the announced-only, exDate-windowed
    // selector with selectUpcoming, which merges announced + projected rows,
    // ascending on the date the card displays (paymentDate, falling back to
    // ex-date — not exDate itself, which is what this test pinned before),
    // and floors at 3 rows by reaching past its 30-day window when fewer
    // qualify inside it. Every fixture here pays 80+ days out, so that floor
    // is what surfaces them at all — this pins the same "reach past the
    // window" behavior end to end that dashboard.test.ts pins as a unit.
    //
    // The 4th row is the frequency-aware projection model's forecast of
    // AAPL's next cycle beyond its one announced payment (AAPL has a past
    // ex-date plus one announced future one — enough to infer a cadence;
    // MSFT's two rows are both announced, so no cadence is inferred beyond
    // them). Its exact date is the model's own output, not a seeded fixture,
    // so it's asserted structurally rather than pinned to a literal.
    const forecastRow = body.upcomingDividends[3];
    expect(typeof forecastRow?.date).toBe("string");
    expect(
      body.upcomingDividends.map((d) => ({
        symbol: d.symbol,
        date: d.date,
        projected: d.projected,
      })),
    ).toEqual([
      { symbol: "MSFT", date: recentPay, projected: false },
      { symbol: "MSFT", date: oldPay, projected: false },
      { symbol: "AAPL", date: announcedPay, projected: false },
      { symbol: "AAPL", date: forecastRow?.date, projected: true },
    ]);
    // The forecast row's own date is a genuine model prediction (not the
    // company declaring it), so dateEstimated must be set on it too — a
    // projected row is never announced-with-a-known-date.
    expect(forecastRow?.dateEstimated).toBe(true);

    // recentDividends: announced rows with paymentDate in [previousMarketDay,
    // today]. Both MSFT rows now have a realistic (future) paymentDate — a
    // dividend that is still genuinely "announced" (future exDate) can never
    // simultaneously have already been paid, so this window is empty for any
    // realistically-dated fixture.
    expect(body.recentDividends).toHaveLength(0);

    // allocation: top 4 sectors by percent + "Other" summing the rest. The
    // fund position buckets under "Funds" (sector.plain, Task 4 finding) and
    // is the single largest slice, landing at the top.
    expect(body.allocation).toEqual([
      { label: "Funds", percent: 28.57 },
      { label: "Sector5", percent: 23.81 },
      { label: "Sector4", percent: 19.05 },
      { label: "Sector3", percent: 14.29 },
      { label: "Other", percent: 14.28 },
    ]);

    // history: default range 1Y in the requested currency, matching
    // /portfolio/history?range=1Y&currency=USD.
    const historyRes = await app.request("/portfolio/history?range=1Y&currency=USD", {
      headers: { cookie },
    });
    const historyBody = await historyRes.json();
    expect(body.history).toEqual(historyBody);
  });
});

describeDb("GET /dashboard — totalReturn", () => {
  let tdb: TestDb;
  let cookie: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    tdb = await withTestDb();

    // Bought at 100, current quote 150 -> gain = (150-100)*10 = 500 on a
    // 1000 basis (no dividends seeded), so totalReturn should be 500 / 50%.
    const provider = new FakeMarketDataProvider({
      quotes: { AAPL: quote("AAPL", "150", "149") },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "dashboard@example.com");

    await post(
      app,
      {
        instrument: instrumentOf("AAPL"),
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: "2026-01-02",
      },
      cookie,
    );
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("returns a display-currency total return aggregating price gain and dividends", async () => {
    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalReturn: { amount: { amount: string; currency: string }; percent: number } | null;
    };
    expect(body.totalReturn).not.toBeNull();
    expect(body.totalReturn!.amount.currency).toBe("USD");
    // 500 / 1000 basis = 50% (no dividends seeded here).
    expect(Number(body.totalReturn!.amount.amount)).toBeCloseTo(500, 0);
    expect(body.totalReturn!.percent).toBeCloseTo(50, 1);
  });
});

describeDb("GET /dashboard — income.dividendTaxRate", () => {
  let tdb: TestDb;
  let cookie: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    tdb = await withTestDb();

    const provider = new FakeMarketDataProvider({
      quotes: { AAPL: quote("AAPL", "150", "149") },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "dashboard@example.com");

    await post(
      app,
      {
        instrument: instrumentOf("AAPL"),
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: "2026-01-02",
      },
      cookie,
    );
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  // dashboard.ts's `income: { ..., dividendTaxRate: income.dividendTaxRate }`
  // is the SOLE source for all Overview netting on the web front page. If that
  // one line were ever dropped, the whole Overview would silently render gross
  // again with no test failing elsewhere — this pins it end-to-end through the
  // real /user/settings PATCH route, the same way dividends-income's sibling
  // test pins /dividends/income.
  it("surfaces the user's configured dividendTaxRate on the dashboard income payload", async () => {
    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    const body = (await res.json()) as { income: { dividendTaxRate: number | null } };
    expect(body.income.dividendTaxRate).toBeNull();

    await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ dividendTaxRate: 35 }),
    });

    const res2 = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    const body2 = (await res2.json()) as { income: { dividendTaxRate: number | null } };
    expect(body2.income.dividendTaxRate).toBe(35);
  });
});

// --- ytdTwrIncomplete -------------------------------------------------------
//
// The dashboard embeds a YTD `buildPerformanceView` call (see the comment
// above the Promise.all in dashboard.ts) but deliberately never sets
// `repairHistory: true` on it -- that flag belongs to GET /performance alone,
// which is the one caller whose entire purpose is the figure and so pays to
// fix it. The overview must still be able to SAY the figure is degraded
// without paying for a blocking upstream fetch to find out.
//
// Both tests below drive the real `/dashboard` route through a real
// `PersistedPriceProvider` over a real `PriceStore` (not a bare
// `FakeMarketDataProvider`), because the detect/repair split lives inside the
// store's coverage check -- a bare fake has no notion of "stored" vs.
// "upstream" at all, so it could never demonstrate that upstream was NOT
// called.

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function priceBar(date: string, close: string, ccy = "USD"): PriceBar {
  const p = Money.of(close, ccy);
  return {
    date: new Date(`${date}T00:00:00Z`),
    open: p,
    high: p,
    low: p,
    close: p,
    volume: new Decimal(1000),
  };
}

/** Stands in for "upstream" behind a `PersistedPriceProvider` — every test
 *  below seeds the `PriceStore` directly (bypassing this stub entirely), so
 *  any call recorded here would mean something reached past the store.
 *  `history` is what it hands back when it IS reached — empty by default
 *  (the "nobody should call this" fixtures), or a full/complete series for
 *  the fixture that needs upstream to be ABLE to repair the gap. */
class CountingProvider implements IMarketDataProvider {
  historyCalls = 0;
  /** When set, `getHistoricalPrices` awaits this instead of `delayMs` --
   *  a manually-released gate rather than a fixed timer. Set to a promise
   *  that never resolves during a test to prove "was `inner` ever awaited on
   *  the BLOCKING path" without paying a real wall-clock wait: a regression
   *  hangs the caller until vitest's own per-test timeout, and a passing run
   *  never touches the gate on the main path at all. Release it explicitly
   *  once assertions are done so any fire-and-forget background call that
   *  DID reach here (expected, not a regression) settles quickly instead of
   *  leaving `afterEach`'s drain waiting on a timer. */
  gate: Promise<void> | null = null;

  constructor(
    private readonly quote: Quote,
    private readonly history: PriceBar[] = [],
    /** Upstream latency. Needed by the "does not block on a repair" fixture:
     *  with an instantly-resolving stub, the fire-and-forget background refresh
     *  can win the race against the store read and fill the gap itself, so the
     *  response looks complete for a reason that has nothing to do with
     *  repair. A delay makes "did the response WAIT?" the only thing the
     *  assertion can be measuring. */
    private readonly delayMs = 0,
  ) {}

  async getHistoricalPrices(): Promise<PriceBar[]> {
    this.historyCalls += 1;
    if (this.gate) await this.gate;
    else if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return this.history;
  }
  getQuote(): Promise<Quote> {
    return Promise.resolve(this.quote);
  }
  getDividendHistory(): Promise<Dividend[]> {
    return Promise.resolve([]);
  }
  searchSymbol(): Promise<SearchResult[]> {
    return Promise.resolve([]);
  }
  getAssetProfile(): Promise<AssetProfile> {
    return Promise.reject(new Error("not needed by this fixture"));
  }
}

/**
 * `firstTrade > windowStart ? firstTrade : windowStart` (valuation-series.ts)
 * — the YTD window's *effective* start is whichever is LATER: Jan 1 of the
 * current UTC year, or the day the position was first bought. Bought one day
 * after Jan 1, "effective start" is always the buy date itself, regardless of
 * how far into the year `now` falls — which sidesteps the whole "how close to
 * Jan 1 is `now`" question for everything computed from it below.
 *
 * The one date this can't rescue: if the suite runs on Jan 1st itself, "one
 * day after Jan 1" would be in the future, so it clamps to yesterday (Dec 31
 * of the prior year) instead — landing before Jan 1, at which point the
 * *window's* start wins and the buy date stops being the effective start this
 * math assumes. On that specific day the YTD window is a single calendar day
 * regardless of any fixture, so it would be `insufficientData` no matter how
 * this is built; not something a fixture can paper over.
 */
function boughtEarlyThisYear(): { buyDaysAgo: number; buy: string } {
  const now = new Date();
  const startOfYearUTC = Date.UTC(now.getUTCFullYear(), 0, 1);
  const daysSinceJan1 = Math.floor((now.getTime() - startOfYearUTC) / 86_400_000);
  const buyDaysAgo = Math.max(1, daysSinceJan1 - 1);
  return { buyDaysAgo, buy: daysAgo(buyDaysAgo) };
}

describeDb("GET /dashboard — ytdTwrIncomplete: does not block on a repair", () => {
  // The distinguishing property between "detect" and "repair" is NOT how many
  // upstream calls happen — PersistedPriceProvider's background-refill gate
  // (`covered = coverage.earliest <= from`) and its blocking-repair gate
  // (`required = coverage.earliest > requireFrom`) are exact logical
  // complements for a single-holding portfolio, since both compare the SAME
  // `coverage.earliest` against the SAME effective date. Any fixture shaped
  // to make one true always makes the other false, so a call-count assertion
  // can never tell "fire-and-forget refill happened" apart from "blocking
  // repair happened" — see the retitled describeDb below for what a
  // call-count assertion CAN actually catch.
  //
  // The real distinguishing property is whether the RESPONSE waited for
  // upstream. Repair blocks on the fetch, writes the repaired bars, and THEN
  // reads the store — so a repaired response would come back complete.
  // Detect-only returns whatever the store already has, immediately. So this
  // fixture makes upstream ABLE to fully repair the gap (it holds the
  // complete history back to the buy date) while the store stays short, and
  // asserts the dashboard's answer still reflects the SHORT store: if the
  // response had waited for upstream, it would have come back complete
  // instead.
  const { buyDaysAgo, buy: BUY } = boughtEarlyThisYear();
  const resumeDaysAgo = Math.max(1, Math.min(buyDaysAgo - 1, Math.floor(buyDaysAgo / 2)));
  const RESUME = daysAgo(resumeDaysAgo);
  // Strictly BETWEEN the buy and the resume, so the anchor prices a date on
  // which AAPL is held and still unpriced. Using RESUME itself would be the
  // very day AAPL's own bars begin, leaving no such date.
  const ANCHOR_MID = daysAgo(Math.floor((buyDaysAgo + resumeDaysAgo) / 2));
  const TODAY = daysAgo(0);

  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    const store = new PriceStore(tdb.db);
    // Short: starts partway through the holding period, same gap shape
    // `historyIncomplete` exists to catch.
    await store.writeBars("AAPL", [priceBar(RESUME, "100"), priceBar(TODAY, "121")], new Date());
    // A fully-priced neighbour held from the same buy date. Without one the
    // series simply STARTS at the first bar and there is no date it can value
    // on which AAPL is held-but-unpriced — a single-holding book cannot tell
    // "this holding has no price" from "the market was shut that day".
    await store.writeBars(
      "ANCHRC",
      [priceBar(BUY, "50"), priceBar(ANCHOR_MID, "50"), priceBar(TODAY, "50")],
      new Date(),
    );

    // Upstream has the FULL history back to the buy date — everything a
    // repair would need to fill the gap, if the route were willing to wait
    // for it.
    const upstream = new CountingProvider(
      quote("AAPL", "121", "120"),
      [priceBar(BUY, "90"), priceBar(RESUME, "100"), priceBar(TODAY, "121")],
      150,
    );
    const provider = new PersistedPriceProvider(store, upstream);
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "ytd-incomplete@example.com");

    await post(
      app,
      {
        instrument: instrumentOf("AAPL"),
        type: "buy",
        quantity: "10",
        price: "90",
        tradeDate: BUY,
      },
      cookie,
    );
    await post(
      app,
      {
        instrument: instrumentOf("ANCHRC"),
        type: "buy",
        quantity: "10",
        price: "50",
        tradeDate: BUY,
      },
      cookie,
    );
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  // Reset the module-level attempt throttle before each test so `mayAttempt`
  // returns true and the repair path (were it reachable) is genuinely
  // reachable — a stale throttle from an earlier test would make this pass
  // for the wrong reason. Drain any fire-and-forget refresh afterward so it
  // can't land during a later test and skew that test's counters instead.
  beforeEach(() => {
    resetPriceAttemptsForTests();
  });
  afterEach(async () => {
    await drainPriceRefreshesForTests();
  });

  it("flags an incomplete YTD figure without blocking on a repair", async () => {
    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ytdTwr: number | null; ytdTwrIncomplete: boolean };

    // Only true if the dashboard did NOT wait for upstream: upstream has the
    // full history, so a repaired answer would be complete, not incomplete.
    expect(body.ytdTwrIncomplete).toBe(true);
  });
});

describeDb("GET /dashboard — ytdTwrIncomplete: does not fetch extra upstream history", () => {
  // NOT a guard against the detect/repair split (see the describeDb above for
  // why a call-count assertion can't pin that). What this DOES catch: the
  // dashboard's YTD call fetching more than it should — e.g. `benchmarks: []`
  // regressing to a non-empty list (confirmed by temporarily setting it to
  // `["sp500"]` while developing this test: historyCalls went from 0 to 3),
  // or some other codepath starting to call `getHistoricalPrices` an extra
  // time. Zero calls is only achievable here because the store's overall
  // earliest/latest span already covers the whole requested window end to
  // end (despite an internal gap) — see the inline comment below — which is
  // exactly the condition that also makes a repair moot, hence the separate
  // fixture above for the property that actually matters.
  const { buyDaysAgo, buy: BUY } = boughtEarlyThisYear();
  // Well outside the valuation series' warm-up look-back (WARMUP_DAYS, 14), not
  // one day before the buy. The series reads a fortnight of bars from before a
  // window start so the first day inside it can forward-fill like any other —
  // a close from the day before 1 January is history it is entitled to use, and
  // with it AAPL is priced from day one and the gap is no gap. For this fixture
  // to describe a book whose stored history genuinely starts after it was
  // bought, the anchor has to sit further back than that read reaches.
  const PRE_BAR = daysAgo(buyDaysAgo + 30);
  const resumeDaysAgo = Math.max(1, Math.min(buyDaysAgo - 1, Math.floor(buyDaysAgo / 2)));
  const RESUME = daysAgo(resumeDaysAgo);
  // Strictly BETWEEN the buy and the resume, so the anchor prices a date on
  // which AAPL is held and still unpriced. Using RESUME itself would be the
  // very day AAPL's own bars begin, leaving no such date.
  const ANCHOR_MID = daysAgo(Math.floor((buyDaysAgo + resumeDaysAgo) / 2));
  const TODAY = daysAgo(0);

  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let counting: CountingProvider;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    const store = new PriceStore(tdb.db);
    // Old anchor bar (outside the window), a gap, then bars resuming after
    // the buy date through today. The anchor makes the store's overall
    // earliest/latest span cover the requested window end to end, which is
    // what keeps PersistedPriceProvider's background-refill path from firing
    // at all here.
    await store.writeBars(
      "AAPL",
      [priceBar(PRE_BAR, "80"), priceBar(RESUME, "100"), priceBar(TODAY, "121")],
      new Date(),
    );
    // A fully-priced neighbour held from the same buy date. Without one the
    // series simply STARTS at the first bar and there is no date it can value
    // on which AAPL is held-but-unpriced — a single-holding book cannot tell
    // "this holding has no price" from "the market was shut that day".
    await store.writeBars(
      "ANCHRC",
      [priceBar(BUY, "50"), priceBar(ANCHOR_MID, "50"), priceBar(TODAY, "50")],
      new Date(),
    );
    // Task 9: the dashboard's embedded YTD call now requests the "sp500"
    // benchmark (see dashboard.ts), so it too must be fully covered here or
    // this fixture's "zero upstream calls" premise would break on a call this
    // test isn't about — "SP500TR.INDX" is the first symbol variant
    // fetchBenchmarkSeries tries for "sp500".
    await store.writeBars(
      "SP500TR.INDX",
      [priceBar(PRE_BAR, "4000"), priceBar(TODAY, "4200")],
      new Date(),
    );

    counting = new CountingProvider(quote("AAPL", "121", "120"));
    const provider = new PersistedPriceProvider(store, counting);
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "ytd-incomplete-nocalls@example.com");

    await post(
      app,
      {
        instrument: instrumentOf("AAPL"),
        type: "buy",
        quantity: "10",
        price: "90",
        tradeDate: BUY,
      },
      cookie,
    );
    await post(
      app,
      {
        instrument: instrumentOf("ANCHRC"),
        type: "buy",
        quantity: "10",
        price: "50",
        tradeDate: BUY,
      },
      cookie,
    );
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  beforeEach(() => {
    resetPriceAttemptsForTests();
  });
  afterEach(async () => {
    await drainPriceRefreshesForTests();
  });

  it("flags an incomplete YTD figure without fetching extra upstream history", async () => {
    const before = counting.historyCalls;

    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ytdTwr: number | null; ytdTwrIncomplete: boolean };

    expect(body.ytdTwrIncomplete).toBe(true);
    expect(counting.historyCalls).toBe(before);
  });
});

describeDb("GET /dashboard — ytdTwrIncomplete: clean history", () => {
  // Same anchoring as above, but the store has a bar AT the buy date (not
  // before it) and nothing is missing after that — nothing for
  // `historyIncomplete` to catch.
  const { buy: BUY } = boughtEarlyThisYear();
  const TODAY = daysAgo(0);

  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    const store = new PriceStore(tdb.db);
    await store.writeBars("AAPL", [priceBar(BUY, "90"), priceBar(TODAY, "121")], new Date());

    const counting = new CountingProvider(quote("AAPL", "121", "120"));
    const provider = new PersistedPriceProvider(store, counting);
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "ytd-complete@example.com");

    await post(
      app,
      {
        instrument: instrumentOf("AAPL"),
        type: "buy",
        quantity: "10",
        price: "90",
        tradeDate: BUY,
      },
      cookie,
    );
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  beforeEach(() => {
    resetPriceAttemptsForTests();
  });
  afterEach(async () => {
    await drainPriceRefreshesForTests();
  });

  it("reports a clean YTD figure as complete", async () => {
    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ytdTwrIncomplete: boolean };
    expect(body.ytdTwrIncomplete).toBe(false);
  });
});

// --- relative (benchmark-relative YTD figure) -------------------------------
//
// Task 9: the dashboard's embedded YTD `buildPerformanceView` call used to pass
// `benchmarks: []`, which meant the overview's Performance card had nothing to
// show relative to an index. Requesting exactly one benchmark (PRIMARY_BENCHMARK_ID,
// exported from services/performance-view.ts) gives it a figure to show, while
// a missing/short/cold benchmark series must degrade to `relative: null` and a
// 200, never a 500 or a hang — see the `benchmarksCacheOnly` fixture further
// below for the cold case specifically.

describeDb("GET /dashboard — relative", () => {
  // Same anchoring as the ytdTwrIncomplete fixtures above: bought one day
  // after Jan 1, so the buy date is the YTD window's effective start.
  const { buy: BUY } = boughtEarlyThisYear();
  const TODAY = daysAgo(0);

  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    const store = new PriceStore(tdb.db);
    await store.writeBars("AAPL", [priceBar(BUY, "90"), priceBar(TODAY, "121")], new Date());
    // Benchmark index bars ("SP500TR.INDX" is the first symbol variant
    // fetchBenchmarkSeries tries for the "sp500" id) spanning the same window,
    // seeded directly into the store so PersistedPriceProvider has coverage
    // and serves them without blocking on upstream.
    await store.writeBars(
      "SP500TR.INDX",
      [priceBar(BUY, "4000"), priceBar(TODAY, "4200")],
      new Date(),
    );

    // Upstream should never be reached: both AAPL and the benchmark are
    // already fully covered by the store for the requested window.
    const upstream = new CountingProvider(quote("AAPL", "121", "120"));
    const provider = new PersistedPriceProvider(store, upstream);
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "dashboard-relative@example.com");

    await post(
      app,
      {
        instrument: instrumentOf("AAPL"),
        type: "buy",
        quantity: "10",
        price: "90",
        tradeDate: BUY,
      },
      cookie,
    );
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  beforeEach(() => {
    resetPriceAttemptsForTests();
  });
  afterEach(async () => {
    await drainPriceRefreshesForTests();
  });

  it("publishes a benchmark-relative YTD figure against the primary default benchmark", async () => {
    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      relative: { benchmarkId: string; benchmarkName: string; pairedDays: number } | null;
    };
    // Present AND non-null — not merely truthy/absent (a field that was never
    // added to the response would make `body.relative` undefined, and
    // `undefined.benchmarkId` throws, which is exactly what should fail this
    // assertion rather than passing it trivially).
    expect(body.relative).not.toBeNull();
    // Against the exported constants, not hand-copied literals: if the
    // primary default ever moves, this test moves with it instead of staying
    // green while silently checking the wrong thing.
    expect(body.relative!.benchmarkId).toBe(PRIMARY_BENCHMARK_ID);
    expect(body.relative!.benchmarkName).toBe(BENCHMARKS[PRIMARY_BENCHMARK_ID]!.name);
    expect(typeof body.relative!.pairedDays).toBe("number");
  });

  // Task 10: `PerformanceRelativeDTO` (the `relative` field above) carries
  // risk ratios, not a return — it has no field that could feed the
  // overview's "gap vs benchmark" figure. `benchmarkYtdTwr` is published
  // separately for exactly that: the same benchmark's own YTD TWR, pulled
  // from `perfYtd.benchmarks[0]` rather than `relative`.
  it("publishes the primary benchmark's own YTD TWR alongside relative", async () => {
    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { benchmarkYtdTwr: number | null };
    // The seeded benchmark bars go 4000 -> 4200, an exact +5%
    // ((4200 - 4000) / 4000) -- pins the derivation, not just "is a number".
    expect(body.benchmarkYtdTwr).toBe(0.05);
  });
});

describeDb("GET /dashboard — relative: null when no benchmark series is available", () => {
  // The overview must never block on or break over a benchmark: it is
  // context, not the page's reason to exist. A bare FakeMarketDataProvider
  // with no history configured answers every getHistoricalPrices call
  // (portfolio AND benchmark alike) with `[]`, so fetchBenchmarkSeries never
  // finds a usable benchmark series and `relative` must come back null — a
  // 200, not a 500, and no hang (a bare Fake resolves synchronously, so
  // there is nothing to hang on; the "does not block" property itself is
  // covered by the persisted-provider fixture above using a real store).
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    const provider = new FakeMarketDataProvider({
      quotes: { AAPL: quote("AAPL", "121", "120") },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "dashboard-relative-null@example.com");

    await post(
      app,
      {
        instrument: instrumentOf("AAPL"),
        type: "buy",
        quantity: "10",
        price: "90",
        tradeDate: "2026-01-02",
      },
      cookie,
    );
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("answers null rather than failing when no benchmark series is available", async () => {
    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // The key must be PRESENT and null, not simply absent — an object that
    // never carries `relative` at all would make `not.toBeNull()` pass on
    // `undefined` just as readily, so pin both.
    expect(Object.prototype.hasOwnProperty.call(body, "relative")).toBe(true);
    expect(body.relative).toBeNull();
  });

  // Same fixture (no usable benchmark series at all), the other half of
  // Task 10's publication: `benchmarkYtdTwr` must degrade to null exactly
  // when `relative` does, since both come from the same cold/absent series.
  it("answers benchmarkYtdTwr: null rather than failing when no benchmark series is available", async () => {
    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, "benchmarkYtdTwr")).toBe(true);
    expect(body.benchmarkYtdTwr).toBeNull();
  });
});

describeDb("GET /dashboard — relative: cold benchmark does not block or fetch upstream", () => {
  // `PersistedPriceProvider.getHistoricalPrices`
  // blocks UNCONDITIONALLY when a symbol's `coverage` is `null` (never fetched
  // into the store before) -- regardless of `requireFrom`, and with no
  // `deadline` escape hatch on that branch (that only exists on the "some
  // coverage already" branch). `fetchBenchmarkSeries` tries each symbol
  // variant for "sp500" (SP500TR.INDX, ^SP500TR) SEQUENTIALLY, so a fresh
  // self-host's first `/dashboard` load could make one blocking upstream call
  // per variant with no bound at all. The fix is
  // `benchmarksCacheOnly: true` on the dashboard's `buildPerformanceView`
  // call (see dashboard.ts), threaded down as `HistoryOptions.cacheOnly`.
  //
  // Round 2 added a second wrinkle this fixture now has to account for: the
  // cold branch (`coverage === null`) also fires a fire-and-forget background
  // refill (see `PersistedPriceProvider`'s `cacheOnly` branch) so a symbol
  // that only ever arrives via `cacheOnly` isn't cold forever. That call DOES
  // reach `inner` -- deliberately -- so "zero new upstream calls" is no
  // longer the right assertion. What must still hold is that the RESPONSE
  // never blocks on it.
  //
  // This is deliberately the SAME test as the "cold-path cost is bounded"
  // cold-store cost guard -- one fixture proves both,
  // since the cost bound IS the blocking fix here.
  //
  // The fixture below seeds AAPL (the portfolio's own holding) but
  // deliberately does NOT seed SP500TR.INDX / ^SP500TR -- that omission is
  // the cold-store case. `hanging.gate` is a promise that
  // never resolves until the test releases it: if the cold branch ever
  // regresses to blocking (`cacheOnly` dropped, ignored, or the check
  // reordered after the upstream call), `await app.request(...)` below hangs
  // on the gate until vitest's per-test timeout and the test FAILS instead of
  // quietly passing. Using a gate rather than a fixed delay means a PASSING
  // run costs nothing: the background refill also awaits the same gate, so
  // it is released once assertions are done rather than making every green
  // run of this test actually wait out an artificial timer.
  const { buy: BUY } = boughtEarlyThisYear();
  const TODAY = daysAgo(0);

  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let hanging: CountingProvider;
  let releaseHanging: () => void;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    const store = new PriceStore(tdb.db);
    // AAPL fully covered so the portfolio's own price history never reaches
    // upstream either -- isolates this fixture to the benchmark path alone.
    await store.writeBars("AAPL", [priceBar(BUY, "90"), priceBar(TODAY, "121")], new Date());
    // SP500TR.INDX / ^SP500TR intentionally NOT seeded: cold benchmark.

    hanging = new CountingProvider(quote("AAPL", "121", "120"), []);
    hanging.gate = new Promise<void>((resolve) => {
      releaseHanging = resolve;
    });
    // NOTE (review round 2 on Task 9): this wires `PersistedPriceProvider`
    // DIRECTLY into `createApp`, not the real production chain
    // (CustomRouting -> Caching -> PersistedPrice, see apps/api/src/index.ts).
    // `CachingMarketDataProvider` sits OUTSIDE this class in production, and a
    // real dashboard request's `cacheOnly` flows through it FIRST -- a bug
    // there (it used to drop `opts` on the plain-window path) was completely
    // invisible to every fixture in this file, this one included, because
    // none of them go through that layer. This file is a good guard for
    // PersistedPriceProvider's OWN cold/cacheOnly behaviour, but it is not
    // sufficient proof that a real `/dashboard` request is safe -- that now
    // additionally lives in
    // `persisted-price-provider.integration.test.ts`'s
    // "keeps cacheOnly from blocking through the real Caching -> Persisted
    // chain" test, which wires both layers together.
    const provider = new PersistedPriceProvider(store, hanging);
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "dashboard-relative-cold@example.com");

    await post(
      app,
      {
        instrument: instrumentOf("AAPL"),
        type: "buy",
        quantity: "10",
        price: "90",
        tradeDate: BUY,
      },
      cookie,
    );
  }, 30_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  beforeEach(() => {
    resetPriceAttemptsForTests();
  });
  afterEach(async () => {
    await drainPriceRefreshesForTests();
  });

  it("answers relative: null within budget on a fully cold benchmark, without blocking on upstream", async () => {
    const before = hanging.historyCalls;

    const res = await app.request("/dashboard?currency=USD", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.relative).toBeNull();
    // The response above only resolved because `hanging.gate` was never
    // touched on the BLOCKING path -- if the cold branch had regressed to
    // awaiting `inner` inline (`cacheOnly` dropped, ignored, or reordered
    // after the upstream call), `await app.request(...)` would still be
    // pending on the never-yet-released gate and this line would never run.
    //
    // It's exactly 3, not 0: the cold branch kicks off a
    // fire-and-forget background refill (bounded by REFRESH_BUDGET) so a
    // benchmark that only ever arrives via `cacheOnly` isn't cold forever.
    // `fetchBenchmarkSeries` tries every sp500 variant sequentially since
    // both are cold here, so each fires its own refill -- reaching `inner`, but
    // never awaited by the response, which is the property this test exists to
    // prove. Counted off `BENCHMARKS` rather than hardcoded: the variant list
    // went from three to two when the benchmark moved to a total-return series,
    // and this assertion should track that rather than have to be found.
    expect(hanging.historyCalls - before).toBe(BENCHMARKS.sp500!.symbols.length);

    // Let the (expected) background refills settle quickly rather than
    // leaving `afterEach`'s drain waiting on a gate nothing will release.
    releaseHanging();
  }, 5_000);
});
