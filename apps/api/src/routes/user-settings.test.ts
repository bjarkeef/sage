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

  it("defaults tapeMotion on, and stores it off when asked", () => {
    expect(fillDefaults(undefined).tapeMotion).toBe(true);
    expect(fillDefaults({ tapeMotion: false }).tapeMotion).toBe(false);
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

  // Logos and thumbnails are the only features that make the browser ask a
  // third party about a holding, so a fresh account must start with both off.
  describe("media privacy settings", () => {
    type Media = {
      showCompanyLogos: boolean;
      showNewsThumbnails: boolean;
      logoDevToken: string | null;
    };

    function patch(cookie: string, body: unknown) {
      return app.request("/user/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
    }

    it("starts a fresh user with logos and thumbnails off and no key", async () => {
      const cookie = await signUpTestUser(app, "media-default-user@example.com");

      const res = await app.request("/user/settings", { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Media;
      expect(body.showCompanyLogos).toBe(false);
      expect(body.showNewsThumbnails).toBe(false);
      expect(body.logoDevToken).toBeNull();
    });

    it("persists both switches and a trimmed key through PATCH then GET", async () => {
      const cookie = await signUpTestUser(app, "media-persist-user@example.com");

      const patchRes = await patch(cookie, {
        showCompanyLogos: true,
        showNewsThumbnails: true,
        logoDevToken: "  pk_test-Key_123  ",
      });
      expect(patchRes.status).toBe(200);
      const patchBody = (await patchRes.json()) as Media;
      expect(patchBody).toMatchObject({
        showCompanyLogos: true,
        showNewsThumbnails: true,
        logoDevToken: "pk_test-Key_123",
      });

      const getBody = (await (
        await app.request("/user/settings", { headers: { cookie } })
      ).json()) as Media;
      expect(getBody).toMatchObject({
        showCompanyLogos: true,
        showNewsThumbnails: true,
        logoDevToken: "pk_test-Key_123",
      });
    });

    it("leaves the media settings untouched when PATCH only sets something else", async () => {
      const cookie = await signUpTestUser(app, "media-untouched-user@example.com");
      await patch(cookie, { showCompanyLogos: true, logoDevToken: "pk_keep" });

      const res = await patch(cookie, { displayCurrency: "EUR" });
      const body = (await res.json()) as Media;
      expect(body.showCompanyLogos).toBe(true);
      expect(body.showNewsThumbnails).toBe(false);
      expect(body.logoDevToken).toBe("pk_keep");
    });

    it("clears the key with null, and with an empty string", async () => {
      const cookie = await signUpTestUser(app, "media-clear-user@example.com");

      await patch(cookie, { logoDevToken: "pk_first" });
      const viaNull = (await (await patch(cookie, { logoDevToken: null })).json()) as Media;
      expect(viaNull.logoDevToken).toBeNull();

      await patch(cookie, { logoDevToken: "pk_second" });
      const viaEmpty = (await (await patch(cookie, { logoDevToken: "   " })).json()) as Media;
      expect(viaEmpty.logoDevToken).toBeNull();

      const getBody = (await (
        await app.request("/user/settings", { headers: { cookie } })
      ).json()) as Media;
      expect(getBody.logoDevToken).toBeNull();
    });

    it("rejects a key that is not a publishable pk_ key, and keeps the stored one", async () => {
      const cookie = await signUpTestUser(app, "media-invalid-user@example.com");
      await patch(cookie, { logoDevToken: "pk_stored" });

      for (const bad of ["sk_secret", "pk_", "pk_has space", "pk_" + "a".repeat(200), 42]) {
        const res = await patch(cookie, { logoDevToken: bad });
        expect(res.status).toBe(400);
      }

      const getBody = (await (
        await app.request("/user/settings", { headers: { cookie } })
      ).json()) as Media;
      expect(getBody.logoDevToken).toBe("pk_stored");
    });

    it("accepts a key of exactly 200 characters", async () => {
      const cookie = await signUpTestUser(app, "media-boundary-user@example.com");
      const key = "pk_" + "a".repeat(197);
      expect(key).toHaveLength(200);

      const res = await patch(cookie, { logoDevToken: key });
      expect(res.status).toBe(200);
      expect(((await res.json()) as Media).logoDevToken).toBe(key);
    });

    it("rejects a non-boolean switch with 400", async () => {
      const cookie = await signUpTestUser(app, "media-bool-user@example.com");

      expect((await patch(cookie, { showCompanyLogos: "yes" })).status).toBe(400);
      expect((await patch(cookie, { showNewsThumbnails: 1 })).status).toBe(400);
    });
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
