import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { DEFAULT_OVERVIEW_PREFS, fillDefaults } from "./user-settings";

describeDb("GET/PATCH /user/settings", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    tdb = await withTestDb();
    const provider = new FakeMarketDataProvider();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("returns all-true overviewPrefs for a fresh user", async () => {
    const cookie = await signUpTestUser(app, "fresh-user@example.com");

    const res = await app.request("/user/settings", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      displayCurrency: string | null;
      overviewPrefs: typeof DEFAULT_OVERVIEW_PREFS;
      dividendTaxRate: number | null;
    };
    expect(body.displayCurrency).toBeNull();
    expect(body.overviewPrefs).toEqual(DEFAULT_OVERVIEW_PREFS);
    expect(body.dividendTaxRate).toBeNull();
  });

  it("round-trips dividendTaxRate through PATCH then GET", async () => {
    const cookie = await signUpTestUser(app, "tax-rate-user@example.com");

    const patchRes = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ dividendTaxRate: 27 }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { dividendTaxRate: number | null };
    expect(patchBody.dividendTaxRate).toBe(27);

    const getRes = await app.request("/user/settings", { headers: { cookie } });
    const getBody = (await getRes.json()) as { dividendTaxRate: number | null };
    expect(getBody.dividendTaxRate).toBe(27);
  });

  it("clears dividendTaxRate back to null via PATCH", async () => {
    const cookie = await signUpTestUser(app, "tax-rate-clear-user@example.com");

    await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ dividendTaxRate: 15.5 }),
    });

    const patchRes = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ dividendTaxRate: null }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { dividendTaxRate: number | null };
    expect(patchBody.dividendTaxRate).toBeNull();
  });

  it("rejects a dividendTaxRate outside 0-100 with 400", async () => {
    const cookie = await signUpTestUser(app, "tax-rate-invalid-user@example.com");

    const res = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ dividendTaxRate: 150 }),
    });
    expect(res.status).toBe(400);
  });

  it("leaves dividendTaxRate untouched when PATCH only sets displayCurrency", async () => {
    const cookie = await signUpTestUser(app, "tax-rate-untouched-user@example.com");

    await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ dividendTaxRate: 20 }),
    });

    const patchRes = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ displayCurrency: "EUR" }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { dividendTaxRate: number | null };
    expect(patchBody.dividendTaxRate).toBe(20);
  });

  it("returns allowNegativeDividendGrowth true by default for a fresh user", async () => {
    const cookie = await signUpTestUser(app, "growth-default-user@example.com");

    const res = await app.request("/user/settings", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allowNegativeDividendGrowth: boolean };
    expect(body.allowNegativeDividendGrowth).toBe(true);
  });

  it("round-trips allowNegativeDividendGrowth through PATCH then GET", async () => {
    const cookie = await signUpTestUser(app, "growth-toggle-user@example.com");

    const patchRes = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ allowNegativeDividendGrowth: false }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { allowNegativeDividendGrowth: boolean };
    expect(patchBody.allowNegativeDividendGrowth).toBe(false);

    const getRes = await app.request("/user/settings", { headers: { cookie } });
    const getBody = (await getRes.json()) as { allowNegativeDividendGrowth: boolean };
    expect(getBody.allowNegativeDividendGrowth).toBe(false);
  });

  it("leaves allowNegativeDividendGrowth untouched when PATCH only sets displayCurrency", async () => {
    const cookie = await signUpTestUser(app, "growth-untouched-user@example.com");

    await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ allowNegativeDividendGrowth: false }),
    });

    const patchRes = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ displayCurrency: "EUR" }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { allowNegativeDividendGrowth: boolean };
    expect(patchBody.allowNegativeDividendGrowth).toBe(false);
  });

  it("rejects a non-boolean allowNegativeDividendGrowth with 400", async () => {
    const cookie = await signUpTestUser(app, "growth-invalid-user@example.com");

    const res = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ allowNegativeDividendGrowth: "no" }),
    });
    expect(res.status).toBe(400);
  });

  it("merges a partial PATCH over stored prefs, leaving the rest untouched", async () => {
    const cookie = await signUpTestUser(app, "merge-user@example.com");

    const patchRes = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ overviewPrefs: { incomeRoom: false } }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as {
      overviewPrefs: typeof DEFAULT_OVERVIEW_PREFS;
    };
    // incomeCard has no stored value yet, so fillDefaults seeds it from the
    // legacy incomeRoom the PATCH just set.
    expect(patchBody.overviewPrefs).toEqual({
      ...DEFAULT_OVERVIEW_PREFS,
      incomeRoom: false,
      incomeCard: false,
    });

    const getRes = await app.request("/user/settings", { headers: { cookie } });
    const getBody = (await getRes.json()) as { overviewPrefs: typeof DEFAULT_OVERVIEW_PREFS };
    expect(getBody.overviewPrefs).toEqual({
      ...DEFAULT_OVERVIEW_PREFS,
      incomeRoom: false,
      incomeCard: false,
    });

    // A second, disjoint partial PATCH must merge over the *stored* value,
    // not replace it — incomeRoom stays false while marketState flips too.
    const secondPatchRes = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ overviewPrefs: { marketState: false } }),
    });
    expect(secondPatchRes.status).toBe(200);
    const secondPatchBody = (await secondPatchRes.json()) as {
      overviewPrefs: typeof DEFAULT_OVERVIEW_PREFS;
    };
    expect(secondPatchBody.overviewPrefs).toEqual({
      ...DEFAULT_OVERVIEW_PREFS,
      incomeRoom: false,
      incomeCard: false,
      marketState: false,
    });
  });

  it("rejects a non-boolean overviewPrefs value with 400", async () => {
    const cookie = await signUpTestUser(app, "invalid-user@example.com");

    const res = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ overviewPrefs: { incomeRoom: "no" } }),
    });
    expect(res.status).toBe(400);
  });

  it("leaves overviewPrefs untouched when PATCH only sets displayCurrency", async () => {
    const cookie = await signUpTestUser(app, "currency-only-user@example.com");

    await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ overviewPrefs: { brief: false } }),
    });

    const patchRes = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ displayCurrency: "EUR" }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as {
      displayCurrency: string | null;
      overviewPrefs: typeof DEFAULT_OVERVIEW_PREFS;
    };
    expect(patchBody.displayCurrency).toBe("EUR");
    expect(patchBody.overviewPrefs).toEqual({ ...DEFAULT_OVERVIEW_PREFS, brief: false });
  });
});

describe("fillDefaults — overview prefs backward compatibility", () => {
  it("defaults new keys: statStrip off, cards on", () => {
    const p = fillDefaults({});
    expect(p.statStrip).toBe(false);
    expect(p.performanceCard).toBe(true);
    expect(p.incomeCard).toBe(true);
    expect(p.portfolioCard).toBe(true);
    expect(p.upcomingCard).toBe(true);
  });

  it("seeds incomeCard/portfolioCard from a legacy room value the user had turned off", () => {
    const p = fillDefaults({ incomeRoom: false, portfolioRoom: false });
    expect(p.incomeCard).toBe(false);
    expect(p.portfolioCard).toBe(false);
  });

  it("prefers an explicit new key over the legacy one", () => {
    const p = fillDefaults({ incomeRoom: false, incomeCard: true });
    expect(p.incomeCard).toBe(true);
  });
});
