import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { Hono } from "hono";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { Money } from "@sage/core";
import { describeDb, withTestDb, type TestDb } from "../testing";
import {
  user,
  portfolio,
  instrument,
  transaction,
  dividendHistory,
  assetProfile,
  customHolding,
} from "../db/schema";
import { assetRoutes } from "./asset";
import type { AppEnv } from "../middleware/session";

/**
 * Route-level test for Task 2 (position extras + income DTO). Every other
 * apps/api route test authenticates by POSTing to `/api/auth/sign-up/email`
 * and reusing the session cookie, but that path currently returns a
 * universal `401 unauthorized` for every integration suite in this repo (a
 * pre-existing environment issue unrelated to this change — see
 * dividends-income.integration.test.ts, which fails the exact same way).
 *
 * `assetRoutes` itself doesn't run better-auth — the top-level `createApp`
 * wires `sessionMiddleware` in front of it, and that middleware's only
 * contract (per apps/api/src/middleware/session.ts) is setting
 * `c.set("user", { id })` on the Hono context. So this test mounts the real
 * route on its own throwaway `Hono<AppEnv>` with a trivial stub middleware
 * that sets the same variable directly — exercising the real route handler,
 * real Postgres (via testcontainers), and a real fake market-data provider,
 * while sidestepping only the broken sign-up call. See instruments.test.ts
 * and middleware/session.test.ts for the same "call the sub-app directly"
 * precedent used elsewhere in this codebase.
 */
describeDb("GET /:slug — position extras and income block", () => {
  let tdb: TestDb;
  let userId: string;
  let portfolioId: string;
  let app: Hono<AppEnv>;

  const DAY = 24 * 60 * 60 * 1000;
  // Two trailing dividends inside the last 12 months, so trailing12m/yield/
  // yield-on-cost all have non-zero, deterministic-sign inputs regardless of
  // when this test runs.
  const exDate1 = new Date(Date.now() - 300 * DAY).toISOString().slice(0, 10);
  const exDate2 = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);
  // KO: a redenomination/primary-listing-change stand-in — two in-window
  // dividends in DIFFERENT currencies, where the LATEST one matches the live
  // quote's currency (USD) but an EARLIER one doesn't (GBP). A guard that only
  // compares the single latest-row currency against the quote — the exact
  // pre-fix behavior — would wrongly pass this and divide a currency-mixed
  // trailing12m by price instead of falling back to profile.dividendYield.
  const koExOlder = new Date(Date.now() - 250 * DAY).toISOString().slice(0, 10);
  const koExNewer = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);

  beforeAll(async () => {
    tdb = await withTestDb();

    userId = "asset-income-user";
    await tdb.db.insert(user).values({
      id: userId,
      name: "Asset Income User",
      email: "asset-income@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [pf] = await tdb.db
      .insert(portfolio)
      .values({ userId, name: "Default" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    await tdb.db.insert(instrument).values([
      { symbol: "AAPL", name: "Apple Inc", exchange: "XNAS", currency: "USD", assetType: "stock" },
      {
        symbol: "MSFT",
        name: "Microsoft Corp",
        exchange: "XNAS",
        currency: "USD",
        assetType: "stock",
      },
      { symbol: "KO", name: "Coca-Cola Co", exchange: "XNYS", currency: "USD", assetType: "stock" },
    ]);

    // Cached profile for KO with a known dividendYield, so the currency-mixed
    // currentYield fallback resolves to a specific, assertable value rather
    // than null.
    await tdb.db.insert(assetProfile).values({
      symbol: "KO",
      name: "Coca-Cola Co",
      exchange: "XNYS",
      assetType: "stock",
      currency: "USD",
      dividendYield: "0.03",
      fetchedAt: new Date(),
    });

    // 10 shares bought 2025-01-02 @ $150, with a $1 fee — feeds
    // position.feesPaid, position.trades, and yieldOnCost's average-cost input.
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "AAPL",
      type: "buy",
      quantity: "10",
      price: "150",
      currency: "USD",
      fee: "1",
      feeCurrency: "USD",
      tradeDate: "2025-01-02",
    });

    // KO: held (5 shares), same day as AAPL — only its dividend currencies differ.
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "KO",
      type: "buy",
      quantity: "5",
      price: "60",
      currency: "USD",
      tradeDate: "2025-01-02",
    });

    await tdb.db.insert(dividendHistory).values([
      { symbol: "AAPL", exDate: exDate1, amountPerShare: "0.5", currency: "USD", source: "test" },
      { symbol: "AAPL", exDate: exDate2, amountPerShare: "0.5", currency: "USD", source: "test" },
      // Earlier in-window payment is GBP; the LATEST one is USD, matching the
      // live quote — a guard comparing only the latest row would miss the mix.
      { symbol: "KO", exDate: koExOlder, amountPerShare: "0.4", currency: "GBP", source: "test" },
      { symbol: "KO", exDate: koExNewer, amountPerShare: "0.3", currency: "USD", source: "test" },
    ]);

    const provider = new FakeMarketDataProvider({
      quotes: {
        AAPL: {
          symbol: "AAPL",
          price: Money.of("150.25", "USD"),
          asOf: new Date(),
          previousClose: null,
        },
        KO: {
          symbol: "KO",
          price: Money.of("60.00", "USD"),
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

  it("returns feesPaid, trades, forwardAnnualIncome and an income block for a held payer", async () => {
    const res = await app.request("/AAPL");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      position: {
        held: boolean;
        feesPaid: { amount: string; currency: string };
        forwardAnnualIncome: { amount: string; currency: string } | null;
        trades: { tradeDate: string; type: string; price: string; quantity: string }[];
      };
      income: {
        currentYield: number | null;
        yieldOnCost: number | null;
        annualDividend: { amount: string; currency: string } | null;
        dividendGrowth5y: string | null;
        nextExDate: string | null;
        payoutRatio: number | null;
      };
    };

    expect(body.position.held).toBe(true);
    expect(body.position.feesPaid.currency).toBe("USD");
    expect(Number(body.position.feesPaid.amount)).toBe(1);
    expect(body.position.trades).toEqual([
      { tradeDate: "2025-01-02", type: "buy", price: "150", quantity: "10" },
    ]);
    expect(body.position.forwardAnnualIncome).not.toBeNull();

    expect(body.income.currentYield).toBeGreaterThan(0);
    expect(body.income.yieldOnCost).toBeGreaterThan(0);
    expect(body.income.annualDividend?.currency).toBe("USD");
    expect(typeof body.income.annualDividend?.amount).toBe("string");
    expect(typeof body.income.nextExDate === "string" || body.income.nextExDate === null).toBe(
      true,
    );
  });

  it("returns held:false and a null yieldOnCost for a symbol with no position", async () => {
    const res = await app.request("/MSFT");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      position: { held: boolean; feesPaid?: unknown; trades?: unknown };
      income: { yieldOnCost: number | null };
    };

    expect(body.position.held).toBe(false);
    expect(body.position.feesPaid).toBeUndefined();
    expect(body.position.trades).toBeUndefined();
    expect(body.income.yieldOnCost).toBeNull();
  });

  it("falls back to profile.dividendYield and nulls annualDividend when trailing dividends mix currencies", async () => {
    const res = await app.request("/KO");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      position: { held: boolean };
      income: { currentYield: number | null; annualDividend: unknown };
    };

    expect(body.position.held).toBe(true);
    // Must equal the cached profile.dividendYield (0.03), not trailing12m
    // (0.4 USD + 0.3 GBP treated as same-currency) ÷ the $60 live price —
    // which a per-latest-row-only currency guard would have wrongly allowed.
    expect(body.income.currentYield).toBeCloseTo(0.03, 6);
    expect(body.income.annualDividend).toBeNull();
  });

  it("returns custom: null for a regular (non-custom) symbol", async () => {
    const res = await app.request("/MSFT");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { custom: unknown };
    expect(body.custom).toBeNull();
  });

  it("attaches a custom block with income settings and a pinned nextPaymentDate for a custom holding", async () => {
    // Pin "today" so nextPaymentDate is deterministic: quarterly cadence from
    // firstPaymentDate 2026-04-30 means the schedule is …, 2026-04-30,
    // 2026-07-30, 2026-10-30, … — with "now" frozen at 2026-07-18, the first
    // date strictly after today is 2026-07-30. Freeze only the Date class (not
    // timers) so the real Postgres/testcontainers I/O below keeps working —
    // same technique as import.integration.test.ts's custom-holding case.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-18T12:00:00Z") });
    try {
      await tdb.db.insert(instrument).values({
        symbol: "CASH_DKK",
        name: "Cash account",
        exchange: "CUSTOM",
        currency: "DKK",
        assetType: "custom",
      });
      await tdb.db.insert(customHolding).values({
        symbol: "CASH_DKK",
        portfolioId,
        holdingType: "savings",
        note: "Test note",
        incomeEnabled: true,
        incomeYearlyPct: "4.25",
        frequencyUnit: "quarter",
        frequencyInterval: 1,
        firstPaymentDate: "2026-04-30",
        lastPaymentDate: null,
        reinvest: true,
      });

      const res = await app.request("/CASH_DKK");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        custom: {
          holdingType: string;
          note: string | null;
          income: {
            yearlyPct: string;
            frequencyUnit: string;
            frequencyInterval: number;
            firstPaymentDate: string;
            lastPaymentDate: string | null;
            reinvest: boolean;
            nextPaymentDate: string | null;
          } | null;
        } | null;
      };

      expect(body.custom).not.toBeNull();
      expect(body.custom!.holdingType).toBe("savings");
      expect(body.custom!.note).toBe("Test note");
      expect(body.custom!.income).not.toBeNull();
      expect(body.custom!.income!.yearlyPct).toBe("4.25");
      expect(body.custom!.income!.frequencyUnit).toBe("quarter");
      expect(body.custom!.income!.reinvest).toBe(true);
      expect(body.custom!.income!.nextPaymentDate).toBe("2026-07-30");

      // Contractual rate must drive yield / next-ex / annual-per-share, not
      // trailing stock-style history (which would understate a young account).
      const withIncome = body as typeof body & {
        income: {
          currentYield: number | null;
          yieldOnCost: number | null;
          nextExDate: string | null;
          annualDividend: { amount: string; currency: string } | null;
        };
      };
      expect(withIncome.income.currentYield).toBeCloseTo(0.0425, 6);
      expect(withIncome.income.nextExDate).toBe("2026-07-30");
      expect(withIncome.income.annualDividend).not.toBeNull();
      expect(withIncome.income.annualDividend!.currency).toBe("DKK");
      // price defaults to 1 when no quote → 0.0425 DKK / share / year
      expect(Number(withIncome.income.annualDividend!.amount)).toBeCloseTo(0.0425, 4);
    } finally {
      vi.useRealTimers();
    }
  });
});
