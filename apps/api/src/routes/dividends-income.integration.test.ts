import { it, expect, beforeAll, afterAll } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { dividendHistory } from "../db/schema";

const apple = {
  symbol: "AAPL",
  name: "Apple Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};

describeDb("GET /dividends/income", () => {
  let tdb: TestDb;
  let cookie: string;
  let app: ReturnType<typeof createApp>;
  let paymentDateCookie: string;

  // The v2 projection model caps announced rows at asOf + 12 months, so the
  // "future" seed must sit inside that window (and stay ahead of the real clock).
  const DAY = 24 * 60 * 60 * 1000;
  const announcedEx = new Date(Date.now() + 100 * DAY).toISOString().slice(0, 10);
  const announcedPay = new Date(Date.now() + 120 * DAY).toISOString().slice(0, 10);

  beforeAll(async () => {
    tdb = await withTestDb();
    const provider = new FakeMarketDataProvider();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "div-income@example.com");

    // Add a buy transaction for AAPL: 10 shares on 2025-01-01
    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: apple,
        type: "buy",
        quantity: "10",
        price: "100",
        tradeDate: "2025-01-01",
      }),
    });

    // Seed dividend history directly
    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "AAPL",
        exDate: "2025-03-15",
        amountPerShare: "0.25",
        currency: "USD",
        source: "test",
      },
      {
        symbol: "AAPL",
        exDate: "2025-06-15",
        amountPerShare: "0.25",
        currency: "USD",
        source: "test",
      },
      {
        symbol: "AAPL",
        exDate: "2025-09-15",
        amountPerShare: "0.25",
        currency: "USD",
        source: "test",
      },
      {
        symbol: "AAPL",
        exDate: "2025-12-15",
        amountPerShare: "0.25",
        currency: "USD",
        source: "test",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("returns retroactive income, projections, and summary", async () => {
    const res = await app.request("/dividends/income", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      retroactive: { symbol: string; income: string }[];
      projected: {
        symbol: string;
        income: string;
        projectedExDate: string;
        paymentDate: string | null;
        paymentDateEstimated: boolean;
        confidence: "high" | "low";
      }[];
      summary: {
        trailingTwelveMonthIncome: { amount: string; currency: string }[];
        projectedTwelveMonthIncome: { amount: string; currency: string }[];
        monthlyBreakdown: { month: string }[];
      };
    };

    // 4 quarterly dividends * 10 shares * $0.25 = $10 total retroactive
    expect(body.retroactive).toHaveLength(4);
    expect(body.retroactive.every((r) => r.symbol === "AAPL")).toBe(true);
    const retroTotal = body.retroactive.reduce((sum, r) => sum + Number(r.income), 0);
    expect(retroTotal).toBeCloseTo(10, 2);

    // v2 projections carry a payment date, an estimated flag, and a confidence grade
    expect(body.projected.length).toBeGreaterThan(0);
    expect(body.projected[0]!.symbol).toBe("AAPL");
    expect(body.projected[0]!.paymentDateEstimated).toBe(true);
    expect(["high", "low"]).toContain(body.projected[0]!.confidence);

    // Summary totals are single-currency here. The trailing amount is deliberately
    // not pinned: it depends on today's date against fixed 2025 ex-dates. The
    // "sums only trailing-12-month payments" test below covers that exactly,
    // using clock-relative fixtures.
    expect(body.summary.trailingTwelveMonthIncome).toHaveLength(1);
    expect(body.summary.trailingTwelveMonthIncome[0]!.currency).toBe("USD");
    expect(body.summary.projectedTwelveMonthIncome).toHaveLength(1);
    expect(body.summary.projectedTwelveMonthIncome[0]!.currency).toBe("USD");
    expect(Number(body.summary.projectedTwelveMonthIncome[0]!.amount)).toBeGreaterThan(0);
    expect(body.summary.monthlyBreakdown.length).toBeGreaterThan(0);
  });

  it("groups monthly income by payment date and excludes future rows from retroactive", async () => {
    // Fresh user with its own AAPL-only history would collide with the O symbol
    // used here, so seed a new user + instrument + transaction for symbol O.
    const res1 = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Payment Date User",
        email: "payment-date@example.com",
        password: "test-password-at-least-8-chars",
      }),
    });
    paymentDateCookie = res1.headers.get("set-cookie")!;

    const realty = {
      symbol: "O",
      name: "Realty Income Corp",
      exchange: "XNYS",
      currency: "USD",
      assetType: "stock",
    };

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: paymentDateCookie },
      body: JSON.stringify({
        instrument: realty,
        type: "buy",
        quantity: "10",
        price: "50",
        tradeDate: "2020-01-01",
      }),
    });

    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "O",
        exDate: "2026-05-29",
        amountPerShare: "0.271",
        currency: "USD",
        paymentDate: "2026-06-15",
        paymentDateEstimated: false,
        source: "test",
      },
      {
        symbol: "O",
        exDate: announcedEx,
        amountPerShare: "0.30",
        currency: "USD",
        paymentDate: announcedPay,
        paymentDateEstimated: false,
        source: "test",
      },
    ]);

    const res = await app.request("/dividends/income", {
      headers: { cookie: paymentDateCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      retroactive: {
        symbol: string;
        exDate: string;
        paymentDate: string | null;
        paymentDateEstimated: boolean;
      }[];
      summary: { monthlyBreakdown: { month: string; retroactive: string }[] };
    };

    // paid row grouped under its PAYMENT month (2026-06), not its ex month (2026-05)
    const juneBucket = body.summary.monthlyBreakdown.find((m) => m.month === "2026-06");
    expect(Number(juneBucket?.retroactive)).toBeCloseTo(2.71, 2);
    const mayBucket = body.summary.monthlyBreakdown.find((m) => m.month === "2026-05");
    expect(mayBucket?.retroactive ?? "0").toBe("0");

    // the future announced row is not retroactive income
    expect(body.retroactive.every((r) => r.exDate !== announcedEx)).toBe(true);
    // retroactive rows expose payment date fields
    expect(body.retroactive[0]).toMatchObject({
      paymentDate: "2026-06-15",
      paymentDateEstimated: false,
    });
  });

  it("exposes future dividend rows as announced income", async () => {
    const res = await app.request("/dividends/income", {
      headers: { cookie: paymentDateCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      announced: {
        symbol: string;
        exDate: string;
        paymentDate: string | null;
        shares: string;
        income: string;
        currency: string;
      }[];
      summary: { monthlyBreakdown: { month: string; announced: string }[] };
    };

    expect(body.announced).toHaveLength(1);
    expect(body.announced[0]).toMatchObject({
      symbol: "O",
      exDate: announcedEx,
      paymentDate: announcedPay,
      shares: "10",
      income: "3.00", // 0.30 * 10
      currency: "USD",
    });

    const bucket = body.summary.monthlyBreakdown.find((m) => m.month === announcedPay.slice(0, 7));
    expect(Number(bucket?.announced)).toBeCloseTo(3.0, 2);
  });

  it("sums only trailing-12-month payments into trailingTwelveMonthIncome, not all-time history", async () => {
    // Fresh user + a symbol not used by other tests, so the assertion is unambiguous.
    const res1 = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Trailing Window User",
        email: "trailing-window@example.com",
        password: "test-password-at-least-8-chars",
      }),
    });
    const trailingCookie = res1.headers.get("set-cookie")!;

    const coke = {
      symbol: "KO",
      name: "Coca-Cola Co",
      exchange: "XNYS",
      currency: "USD",
      assetType: "stock",
    };

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: trailingCookie },
      body: JSON.stringify({
        instrument: coke,
        type: "buy",
        quantity: "10",
        price: "50",
        tradeDate: "2015-01-01",
      }),
    });

    // One payment ~13 months ago (outside the trailing 12-month window) and one
    // ~2 months ago (inside it). Both are past ex-dates so both count as
    // retroactive income, but only the recent one should land in the
    // trailing-12-month summary total.
    const oldExDate = new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10);
    const oldPaymentDate = new Date(Date.now() - 395 * DAY).toISOString().slice(0, 10);
    const recentExDate = new Date(Date.now() - 65 * DAY).toISOString().slice(0, 10);
    const recentPaymentDate = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);

    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "KO",
        exDate: oldExDate,
        amountPerShare: "0.46",
        currency: "USD",
        paymentDate: oldPaymentDate,
        paymentDateEstimated: false,
        source: "test",
      },
      {
        symbol: "KO",
        exDate: recentExDate,
        amountPerShare: "0.46",
        currency: "USD",
        paymentDate: recentPaymentDate,
        paymentDateEstimated: false,
        source: "test",
      },
    ]);

    const res = await app.request("/dividends/income", {
      headers: { cookie: trailingCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      retroactive: { exDate: string; income: string }[];
      summary: { trailingTwelveMonthIncome: { amount: string; currency: string }[] };
    };

    // Both payments are past ex-dates, so both count as retroactive income.
    expect(body.retroactive).toHaveLength(2);

    // But only the ~2-month-ago payment (10 shares * $0.46 = $4.60) is within
    // the trailing 12 months — NOT the sum of both ($9.20).
    expect(Number(body.summary.trailingTwelveMonthIncome[0]!.amount)).toBeCloseTo(4.6, 2);
  });

  it("returns perHolding analytics with income share summing to ~1", async () => {
    // Seed 3 years of growing AAPL dividends so CAGR is computable.
    await tdb.db
      .insert(dividendHistory)
      .values([
        {
          symbol: "AAPL",
          exDate: "2023-02-10",
          amountPerShare: "0.80",
          currency: "USD",
          source: "test",
        },
        {
          symbol: "AAPL",
          exDate: "2024-02-10",
          amountPerShare: "0.90",
          currency: "USD",
          source: "test",
        },
        {
          symbol: "AAPL",
          exDate: "2025-02-10",
          amountPerShare: "1.00",
          currency: "USD",
          source: "test",
        },
      ])
      .onConflictDoNothing();

    const res = await app.request("/dividends/income", { headers: { cookie } });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      perHolding: {
        symbol: string;
        forwardAnnualIncome: { amount: string; currency: string };
        incomeShare: number;
        cagr5y: string | null;
        trend: string;
      }[];
    };

    expect(Array.isArray(body.perHolding)).toBe(true);
    const aapl = body.perHolding.find((h) => h.symbol === "AAPL");
    expect(aapl).toBeDefined();
    expect(aapl!.forwardAnnualIncome).toHaveProperty("amount");
    expect(typeof aapl!.incomeShare).toBe("number");
    expect(["climbing", "flat", "cutting", "unknown"]).toContain(aapl!.trend);

    // This fixture's only symbol (AAPL) has quarterly history that projects
    // forward, so forward income must be present here — otherwise the
    // shareSum assertion below would trivially pass on a sum of 0.
    expect(Number(aapl!.forwardAnnualIncome.amount)).toBeGreaterThan(0);

    const shareSum = body.perHolding.reduce((s, h) => s + h.incomeShare, 0);
    // With forward income present, shares of the (single) forward-paying
    // holding must sum to ~1 — proves the share-normalization invariant.
    expect(shareSum).toBeCloseTo(1, 5);
  });

  it("returns receivedByYear grouped from paid dividends", async () => {
    const res = await app.request("/dividends/income", { headers: { cookie } });
    const body = (await res.json()) as {
      summary: { receivedByYear: { year: string; amount: string; currency: string }[] };
    };
    expect(Array.isArray(body.summary.receivedByYear)).toBe(true);
    for (const row of body.summary.receivedByYear) {
      expect(row).toHaveProperty("year");
      expect(row).toHaveProperty("amount");
      expect(row).toHaveProperty("currency");
    }
  });

  it("returns incomeByGroup with holdings/sector/currency, shares summing to ~1", async () => {
    const res = await app.request("/dividends/income", { headers: { cookie } });
    type GroupRow = { label: string; amount: { amount: string; currency: string }; share: number };
    const body = (await res.json()) as {
      incomeByGroup: { holdings: GroupRow[]; sector: GroupRow[]; currency: GroupRow[] };
      perHolding: {
        symbol: string;
        forwardAnnualIncome: { amount: string };
        incomeShare: number;
      }[];
    };
    expect(body.incomeByGroup).toBeDefined();
    for (const key of ["holdings", "sector", "currency"] as const) {
      expect(Array.isArray(body.incomeByGroup[key])).toBe(true);
      const anyForward = body.perHolding.some((h) => Number(h.forwardAnnualIncome.amount) > 0);
      if (anyForward) {
        const sum = body.incomeByGroup[key].reduce((s, r) => s + r.share, 0);
        expect(sum).toBeCloseTo(1, 5);
      }
    }
    // currency grouping labels are currency codes
    for (const r of body.incomeByGroup.currency) expect(typeof r.label).toBe("string");
    // this fixture's AAPL has no asset profile seeded, so sector groups under "Unknown"
    expect(body.incomeByGroup.sector.some((r) => r.label === "Unknown")).toBe(true);
    // holdings shares must reconcile with perHolding's own incomeShare (shared source map)
    const aaplHolding = body.perHolding.find((h) => h.symbol === "AAPL");
    const aaplGroup = body.incomeByGroup.holdings.find((r) => r.label === "Apple Inc");
    expect(aaplGroup?.share).toBeCloseTo(aaplHolding!.incomeShare, 5);
  });

  it("returns dividendTaxRate null by default, reflecting the user setting once patched", async () => {
    const signUpRes = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Tax Rate User",
        email: "tax-rate-div@example.com",
        password: "test-password-at-least-8-chars",
      }),
    });
    const taxCookie = signUpRes.headers.get("set-cookie")!;

    const res = await app.request("/dividends/income", { headers: { cookie: taxCookie } });
    const body = (await res.json()) as { dividendTaxRate: number | null };
    expect(body.dividendTaxRate).toBeNull();

    await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: taxCookie },
      body: JSON.stringify({ dividendTaxRate: 27 }),
    });

    const res2 = await app.request("/dividends/income", { headers: { cookie: taxCookie } });
    const body2 = (await res2.json()) as { dividendTaxRate: number | null };
    expect(body2.dividendTaxRate).toBe(27);
  });

  it("counts an ex-passed-but-unpaid dividend as forward income, not paid", async () => {
    // A dividend whose ex-date has passed but whose payment is still ahead is
    // "in flight": the cash hasn't landed, yet it's the most certain forward
    // income there is. It must be (a) NOT counted as trailing/received, (b)
    // shown as a confirmed *upcoming* payment (announced bucket) in its payment
    // month — never as "paid" in a future month — and (c) included in the
    // forward projection total AND the income-by-group shares so the forward
    // hero, donut, and "Next 12 months" chart all reconcile to one number.
    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "In Flight User",
        email: "in-flight-div@example.com",
        password: "test-password-at-least-8-chars",
      }),
    });
    const inFlightCookie = signUp.headers.get("set-cookie")!;

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: inFlightCookie },
      body: JSON.stringify({
        instrument: {
          symbol: "ORCHRD",
          name: "Orchard Capital",
          exchange: "XNYS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "40",
        tradeDate: "2020-01-01",
      }),
    });

    const inFlightEx = new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10);
    const inFlightPay = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "ORCHRD",
        exDate: inFlightEx,
        amountPerShare: "0.24",
        currency: "USD",
        paymentDate: inFlightPay,
        paymentDateEstimated: false,
        source: "test",
      },
    ]);

    const res = await app.request("/dividends/income", { headers: { cookie: inFlightCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      perHolding: { symbol: string; forwardAnnualIncome: { amount: string } }[];
      incomeByGroup: { holdings: { share: number }[] };
      summary: {
        trailingTwelveMonthIncome: { amount: string }[];
        projectedTwelveMonthIncome: { amount: string }[];
        monthlyBreakdown: { month: string; retroactive: string; announced: string }[];
      };
    };

    // (a) not received yet — cash hasn't landed
    expect(Number(body.summary.trailingTwelveMonthIncome[0]!.amount)).toBe(0);

    // (b) surfaces in its PAYMENT month as announced (upcoming), never paid
    const payMonth = inFlightPay.slice(0, 7);
    const payBucket = body.summary.monthlyBreakdown.find((m) => m.month === payMonth);
    expect(Number(payBucket?.announced)).toBeCloseTo(2.4, 2); // 0.24 * 10
    expect(Number(payBucket?.retroactive ?? "0")).toBe(0);

    // (c) counted in the forward projection total and per-holding forward income
    expect(Number(body.summary.projectedTwelveMonthIncome[0]!.amount)).toBeGreaterThanOrEqual(2.4);
    const main = body.perHolding.find((h) => h.symbol === "ORCHRD");
    expect(Number(main!.forwardAnnualIncome.amount)).toBeGreaterThanOrEqual(2.4);

    // reconciliation: donut shares still normalize to ~1 with the in-flight row folded in
    const shareSum = body.incomeByGroup.holdings.reduce((s, r) => s + r.share, 0);
    expect(shareSum).toBeCloseTo(1, 5);
  });

  it("returns empty arrays when no positions exist", async () => {
    // Create a fresh user with no transactions
    const res2 = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Empty User",
        email: "empty-div@example.com",
        password: "test-password-at-least-8-chars",
      }),
    });
    const emptyCookie = res2.headers.get("set-cookie")!;

    const res = await app.request("/dividends/income", {
      headers: { cookie: emptyCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      retroactive: unknown[];
      projected: unknown[];
    };
    expect(body.retroactive).toEqual([]);
    expect(body.projected).toEqual([]);
  });
});
