import { it, expect, beforeAll, afterAll } from "vitest";
import { Money } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { Quote } from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { dividendHistory } from "../db/schema";

function quote(symbol: string, price: string, ccy = "USD"): Quote {
  return { symbol, price: Money.of(price, ccy), asOf: new Date(), previousClose: null };
}

async function signUp(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Goal User", email, password: "test-password-at-least-8-chars" }),
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status}`);
  return res.headers.get("set-cookie")!;
}

describeDb("/goal", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;
  const thisYear = new Date().getFullYear();

  beforeAll(async () => {
    tdb = await withTestDb();
    const provider = new FakeMarketDataProvider({
      quotes: { KO: quote("KO", "60"), "ALBION.L": quote("ALBION.L", "1.2", "GBP") },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUp(app, "goal-user@example.com");

    // 100 shares KO @ 50, bought within the trailing 12 months → market value
    // 6000 USD and a computable avg monthly contribution (5000/12).
    const buyDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: {
          symbol: "KO",
          name: "Coca-Cola",
          exchange: "XNYS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "100",
        price: "50",
        tradeDate: buyDate,
      }),
    });
    // Past dividend so KO has history → forward projection → non-null yield.
    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "KO",
        exDate: "2026-03-01",
        amountPerShare: "0.46",
        currency: "USD",
        paymentDate: "2026-03-15",
        paymentDateEstimated: false,
        source: "test",
      },
      {
        symbol: "KO",
        exDate: "2025-12-01",
        amountPerShare: "0.46",
        currency: "USD",
        paymentDate: "2025-12-15",
        paymentDateEstimated: false,
        source: "test",
      },
      {
        symbol: "KO",
        exDate: "2025-09-01",
        amountPerShare: "0.46",
        currency: "USD",
        paymentDate: "2025-09-15",
        paymentDateEstimated: false,
        source: "test",
      },
      {
        symbol: "KO",
        exDate: "2025-06-01",
        amountPerShare: "0.46",
        currency: "USD",
        paymentDate: "2025-06-15",
        paymentDateEstimated: false,
        source: "test",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("GET with no goal returns null goal + computed defaults", async () => {
    const res = await app.request("/goal", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      goal: unknown;
      defaults: {
        currency: string;
        divYieldPct: string | null;
        monthlyContribution: string;
      } | null;
      result: unknown;
    };
    expect(body.goal).toBeNull();
    expect(body.result).toBeNull();
    expect(body.defaults).not.toBeNull();
    expect(body.defaults!.currency).toBe("USD");
    // 100 sh × 0.46 × 4 ≈ 184/yr forward on 6000 value ≈ 3.07% yield
    expect(Number(body.defaults!.divYieldPct)).toBeGreaterThan(1);
    // 5000 of buys ÷ 12 ≈ 416.67/mo
    expect(Number(body.defaults!.monthlyContribution)).toBeCloseTo(416.67, 1);
  });

  it("PUT saves a goal and returns a calculated result with scenarios", async () => {
    const res = await app.request("/goal", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "passive_income",
        amount: 12000,
        targetYear: thisYear + 10,
        monthlyContribution: 1000,
        contributionIncrease: "inflation",
        contributionIncreasePct: null,
        divYieldPct: null,
        divGrowthPct: 5,
        annualReturnPct: null,
        adjustGoalForInflation: true,
        inflationPct: 2.5,
        reinvestDividends: true,
        suggestAlternative: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      goal: { amount: string; targetYear: number; currency: string } | null;
      result: {
        progressPct: number;
        currentMetric: string;
        goalAtTargetYear: string;
        scenarios: { id: string; rows: { year: number; achieved: boolean }[] }[];
      } | null;
    };
    expect(body.goal).not.toBeNull();
    expect(body.goal!.currency).toBe("USD"); // server-assigned, not client input
    expect(body.result).not.toBeNull();
    expect(body.result!.progressPct).toBeGreaterThan(0);
    // goalAtTargetYear = 12000 × 1.025^10 ≈ 15361
    expect(Number(body.result!.goalAtTargetYear)).toBeCloseTo(15361, -1);
    expect(body.result!.scenarios[0]!.id).toBe("portfolio");
    expect(body.result!.scenarios[0]!.rows.length).toBeGreaterThan(10);
  });

  it("GET after PUT returns the stored goal", async () => {
    const res = await app.request("/goal", { headers: { cookie } });
    const body = (await res.json()) as { goal: { targetYear: number } | null };
    expect(body.goal!.targetYear).toBe(thisYear + 10);
  });

  it("PUT rejects invalid bodies", async () => {
    const res = await app.request("/goal", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "passive_income", amount: -5, targetYear: 1990 }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE removes the goal", async () => {
    const res = await app.request("/goal", { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(204);
    const after = await app.request("/goal", { headers: { cookie } });
    const body = (await after.json()) as { goal: unknown };
    expect(body.goal).toBeNull();
  });

  it("net mode activates when the user has a dividend tax rate", async () => {
    await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ dividendTaxRate: 27 }),
    });
    const res = await app.request("/goal", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "passive_income",
        amount: 12000,
        targetYear: thisYear + 10,
        monthlyContribution: 1000,
        contributionIncrease: "none",
        contributionIncreasePct: null,
        divYieldPct: 3,
        divGrowthPct: 5,
        annualReturnPct: null,
        adjustGoalForInflation: false,
        inflationPct: 2.5,
        reinvestDividends: true,
        suggestAlternative: false,
      }),
    });
    const body = (await res.json()) as {
      result: { netMode: boolean; currentMetric: string } | null;
    };
    expect(body.result!.netMode).toBe(true);
    // net current income = 6000 × 3% × 0.73 = 131.40
    expect(Number(body.result!.currentMetric)).toBeCloseTo(131.4, 0);
  });

  it("PATCHing the display currency after saving returns a currency-mismatch reason, not stale numbers", async () => {
    // `cookie`'s user has a goal saved in USD from the previous test (server-
    // assigned currency). Recompute the display currency to something else —
    // the computation currency now differs from the stored goal's currency,
    // so the guard must refuse to compute a (silently wrong) result while
    // still surfacing the goal + defaults so the form renders.
    await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ displayCurrency: "EUR" }),
    });
    const res = await app.request("/goal", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      goal: { currency: string } | null;
      defaults: unknown;
      result: unknown;
      reason?: string;
    };
    expect(body.goal).not.toBeNull();
    expect(body.goal!.currency).toBe("USD");
    expect(body.defaults).not.toBeNull();
    expect(body.result).toBeNull();
    expect(body.reason).toMatch(/save the goal again|display currency/i);

    // Reset so later tests aren't affected by the override.
    await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ displayCurrency: null }),
    });
  });

  it("returns a reason and no defaults for an empty portfolio", async () => {
    const emptyCookie = await signUp(app, "goal-empty@example.com");
    const res = await app.request("/goal", { headers: { cookie: emptyCookie } });
    const body = (await res.json()) as { defaults: unknown; result: unknown; reason?: string };
    expect(body.defaults).toBeNull();
    expect(body.result).toBeNull();
    expect(body.reason).toMatch(/no positions/i);
  });

  it("returns a reason for a multi-currency portfolio without a display currency", async () => {
    const mixedCookie = await signUp(app, "goal-mixed@example.com");
    const buyDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const [instrument, price] of [
      [
        { symbol: "KO", name: "Coca-Cola", exchange: "XNYS", currency: "USD", assetType: "stock" },
        "50",
      ],
      [
        {
          symbol: "ALBION.L",
          name: "Albion Telecom",
          exchange: "XLON",
          currency: "GBP",
          assetType: "stock",
        },
        "1",
      ],
    ] as const) {
      await app.request("/transactions", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: mixedCookie },
        body: JSON.stringify({
          instrument,
          type: "buy",
          quantity: "10",
          price,
          tradeDate: buyDate,
        }),
      });
    }
    const res = await app.request("/goal", { headers: { cookie: mixedCookie } });
    const body = (await res.json()) as { defaults: unknown; reason?: string };
    expect(body.defaults).toBeNull();
    expect(body.reason).toMatch(/display currency/i);
  });
});

describeDb("/goal — allowNegativeDividendGrowth clamp", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  const DAY_MS = 24 * 60 * 60 * 1000;
  function isoDaysAgo(days: number): string {
    return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    tdb = await withTestDb();
    const provider = new FakeMarketDataProvider({ quotes: { XYZ: quote("XYZ", "10") } });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUp(app, "goal-clamp-user@example.com");

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: {
          symbol: "XYZ",
          name: "Decliner Inc",
          exchange: "XNYS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "100",
        price: "10",
        tradeDate: isoDaysAgo(1800),
      }),
    });

    // A cleanly declining quarterly payer: five years of consistent quarterly
    // payments, amount rising the further back in time (i.e. shrinking as it
    // approaches today), so cagr5y is unambiguously negative. Offsets are
    // wall-clock relative (not calendar-literal) so this test is stable
    // regardless of what day it actually runs.
    const bucketOffsetsDays = [
      [30, 120, 210, 300], // most recent year — lowest amount
      [395, 485, 575, 665],
      [760, 850, 940, 1030],
      [1125, 1215, 1305, 1395],
      [1490, 1580, 1670, 1760], // five years ago — highest amount
    ];
    const rows = bucketOffsetsDays.flatMap((offsets, y) =>
      offsets.map((days) => ({
        symbol: "XYZ",
        exDate: isoDaysAgo(days),
        amountPerShare: (0.1 + y * 0.05).toFixed(2),
        currency: "USD",
        paymentDate: isoDaysAgo(days),
        paymentDateEstimated: false,
        source: "test",
      })),
    );
    await tdb.db.insert(dividendHistory).values(rows);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("floors the weighted divGrowthPct default at 0 once allowNegativeDividendGrowth is turned off", async () => {
    const before = await app.request("/goal", { headers: { cookie } });
    const beforeBody = (await before.json()) as {
      defaults: { divGrowthPct: string | null } | null;
    };
    expect(beforeBody.defaults).not.toBeNull();
    expect(Number(beforeBody.defaults!.divGrowthPct)).toBeLessThan(0);

    const patchRes = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ allowNegativeDividendGrowth: false }),
    });
    expect(patchRes.status).toBe(200);

    const after = await app.request("/goal", { headers: { cookie } });
    const afterBody = (await after.json()) as {
      defaults: { divGrowthPct: string | null } | null;
    };
    expect(Number(afterBody.defaults!.divGrowthPct)).toBe(0);
  });
});
