import { it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { Money, Decimal } from "@sage/core";
import type { Quote, IFxRateService } from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { portfolio, instrument, category, categoryAssignment, user } from "../db/schema";
import type { CategoriesViewBody } from "../services/categories-view";

function quote(symbol: string, price: string, ccy: string): Quote {
  return { symbol, price: Money.of(price, ccy), asOf: new Date("2026-07-19"), previousClose: null };
}

async function postTx(
  app: ReturnType<typeof createApp>,
  cookie: string,
  body: Record<string, unknown>,
) {
  const res = await app.request("/transactions", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`tx failed: ${res.status} ${await res.text()}`);
}

describeDb("category schema", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let portfolioId: string;

  beforeAll(async () => {
    tdb = await withTestDb();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, new FakeMarketDataProvider(), auth);
    await signUpTestUser(app, "schema-user@example.com");
    const [p] = await tdb.db.select().from(portfolio).limit(1);
    portfolioId = p!.id;
    await tdb.db.insert(instrument).values({
      symbol: "AAPL",
      name: "Apple Inc",
      exchange: "XNAS",
      currency: "USD",
      assetType: "stock",
    });
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("rejects a duplicate category name within one portfolio", async () => {
    await tdb.db.insert(category).values({ portfolioId, name: "Growth", position: 0 });
    await expect(
      tdb.db.insert(category).values({ portfolioId, name: "Growth", position: 1 }),
    ).rejects.toThrow();
  });

  // Root uniqueness is enforced by a PARTIAL INDEX, not by the composite
  // constraint: Postgres treats NULLs as distinct, so `unique (portfolio_id,
  // parent_id, name)` permits any number of root rows sharing a name. Drop the
  // partial index and the test above goes green while this one still passes —
  // which is why both exist.
  it("allows a name to repeat under different parents but not among siblings", async () => {
    const [alpha] = await tdb.db
      .insert(category)
      .values({ portfolioId, name: "Alpha", position: 0 })
      .returning();
    const [beta] = await tdb.db
      .insert(category)
      .values({ portfolioId, name: "Beta", position: 1 })
      .returning();

    await tdb.db
      .insert(category)
      .values({ portfolioId, parentId: alpha!.id, name: "Bonds", position: 0 });
    await tdb.db
      .insert(category)
      .values({ portfolioId, parentId: beta!.id, name: "Bonds", position: 0 });

    await expect(
      tdb.db
        .insert(category)
        .values({ portfolioId, parentId: alpha!.id, name: "Bonds", position: 1 }),
    ).rejects.toThrow();
  });

  it("deletes the whole subtree when a parent category is deleted", async () => {
    const [parent] = await tdb.db
      .insert(category)
      .values({ portfolioId, name: "Trunk", position: 0 })
      .returning();
    const [child] = await tdb.db
      .insert(category)
      .values({ portfolioId, parentId: parent!.id, name: "Branch", position: 0 })
      .returning();
    await tdb.db
      .insert(category)
      .values({ portfolioId, parentId: child!.id, name: "Twig", position: 0 });

    await tdb.db.delete(category).where(eq(category.id, parent!.id));

    const left = await tdb.db.select().from(category).where(eq(category.portfolioId, portfolioId));
    expect(left.map((c) => c.name)).not.toContain("Branch");
    expect(left.map((c) => c.name)).not.toContain("Twig");
  });

  it("rejects a second assignment for the same symbol in one portfolio", async () => {
    const [cat] = await tdb.db
      .insert(category)
      .values({ portfolioId, name: "Tech", position: 0 })
      .returning();
    await tdb.db
      .insert(categoryAssignment)
      .values({ portfolioId, symbol: "AAPL", categoryId: cat!.id });
    await expect(
      tdb.db
        .insert(categoryAssignment)
        .values({ portfolioId, symbol: "AAPL", categoryId: null, targetPct: "5" }),
    ).rejects.toThrow();
  });

  it("cascades assignment rows when their category is deleted", async () => {
    const [cat] = await tdb.db
      .insert(category)
      .values({ portfolioId, name: "Doomed", position: 0 })
      .returning();
    await tdb.db.insert(instrument).values({
      symbol: "MSFT",
      name: "Microsoft",
      exchange: "XNAS",
      currency: "USD",
      assetType: "stock",
    });
    await tdb.db
      .insert(categoryAssignment)
      .values({ portfolioId, symbol: "MSFT", categoryId: cat!.id });
    await tdb.db.delete(category).where(eq(category.id, cat!.id));
    const rows = await tdb.db
      .select()
      .from(categoryAssignment)
      .where(eq(categoryAssignment.symbol, "MSFT"));
    expect(rows).toHaveLength(0);
  });
});

const aapl = {
  symbol: "AAPL2",
  name: "Apple Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};
const msft = {
  symbol: "MSFT2",
  name: "Microsoft",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};
const sold = {
  symbol: "SOLD2",
  name: "Sold Corp",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};
const dead = {
  symbol: "DEAD2",
  name: "No Quote Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};

describeDb("GET /categories/view", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;
  let portfolioId: string;

  beforeAll(async () => {
    tdb = await withTestDb();
    const provider = new FakeMarketDataProvider({
      quotes: {
        AAPL2: quote("AAPL2", "200", "USD"), // 10 shares -> 2000
        MSFT2: quote("MSFT2", "100", "USD"), // 10 shares -> 1000
        // DEAD2 has no quote -> cost-basis fallback (10 * 50 = 500)
      },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "view-user@example.com");
    const [p] = await tdb.db.select().from(portfolio).limit(1);
    portfolioId = p!.id;

    await postTx(app, cookie, {
      instrument: aapl,
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "2026-01-01",
    });
    await postTx(app, cookie, {
      instrument: msft,
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "2026-01-01",
    });
    await postTx(app, cookie, {
      instrument: dead,
      type: "buy",
      quantity: "10",
      price: "50",
      tradeDate: "2026-01-01",
    });
    // Fully sold — must not appear anywhere
    await postTx(app, cookie, {
      instrument: sold,
      type: "buy",
      quantity: "5",
      price: "10",
      tradeDate: "2026-01-01",
    });
    await postTx(app, cookie, {
      instrument: sold,
      type: "sell",
      quantity: "5",
      price: "12",
      tradeDate: "2026-02-01",
    });

    const [growth] = await tdb.db
      .insert(category)
      .values({ portfolioId, name: "Growth", targetPct: "60", position: 0 })
      .returning();
    await tdb.db.insert(categoryAssignment).values([
      { portfolioId, symbol: "AAPL2", categoryId: growth!.id },
      // SOLD2 assigned but fully sold: excluded from view, row persists
      { portfolioId, symbol: "SOLD2", categoryId: growth!.id },
      // Top-level asset target (a loose asset with a target of its own)
      { portfolioId, symbol: "MSFT2", categoryId: null, targetPct: "30" },
    ]);
    // DEAD2 gets no row -> unallocated
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("groups holdings, computes actual vs target, and derives unallocated", async () => {
    const res = await app.request("/categories/view", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;

    // Total = 2000 (AAPL2) + 1000 (MSFT2) + 500 (DEAD2 cost-basis fallback) = 3500
    expect(body.totals.value).toEqual({ amount: "3500.00", currency: "USD" });
    // Invested = 1000 + 1000 + 500; gain = 3500 - 2500; gainPercent = 1000/2500
    expect(body.totals.invested).toEqual({ amount: "2500.00", currency: "USD" });
    expect(body.totals.gain).toEqual({ amount: "1000.00", currency: "USD" });
    expect(body.totals.gainPercent).toBe(40);
    expect(body.totals.targetPctSum).toBe(90);

    expect(body.root.children).toHaveLength(1);
    const growth = body.root.children[0]!;
    expect(growth.name).toBe("Growth");
    expect(growth.targetPct).toBe(60);
    expect(growth.value).toEqual({ amount: "2000.00", currency: "USD" });
    expect(growth.invested).toEqual({ amount: "1000.00", currency: "USD" });
    expect(growth.gain).toEqual({ amount: "1000.00", currency: "USD" });
    expect(growth.gainPercent).toBe(100);
    // pct() rounds to exactly 2dp server-side, so exact equality holds.
    expect(growth.actualPct).toBe(57.14);
    // Sold position excluded even though assigned
    expect(growth.holdings.map((h: { symbol: string }) => h.symbol)).toEqual(["AAPL2"]);

    expect(body.root.holdings).toHaveLength(1);
    expect(body.root.holdings[0]!.symbol).toBe("MSFT2");
    expect(body.root.holdings[0]!.targetPct).toBe(30);
    expect(body.root.holdings[0]!.weightPct).toBe(28.57);

    expect(body.unallocated.map((h: { symbol: string }) => h.symbol)).toEqual(["DEAD2"]);
    // Cost-basis fallback value for the quoteless symbol
    expect(body.unallocated[0]!.value).toEqual({ amount: "500.00", currency: "USD" });
  });

  it("returns empty groups for a portfolio with no categories", async () => {
    const freshCookie = await signUpTestUser(app, "view-empty@example.com");
    const res = await app.request("/categories/view", { headers: { cookie: freshCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;
    expect(body.root.children).toEqual([]);
    expect(body.root.holdings).toEqual([]);
    expect(body.unallocated).toEqual([]);
    expect(body.totals.targetPctSum).toBeNull();
  });

  it("converts FX when displaying in a different currency", async () => {
    const fxStub: IFxRateService = {
      getRate: () => Promise.resolve(new Decimal("0.5")),
      getRates: (_base, targets) =>
        Promise.resolve(new Map(targets.map((t) => [t, new Decimal("0.5")]))),
    };

    const providerWithBoth = new FakeMarketDataProvider({
      quotes: {
        USDX1: quote("USDX1", "100", "USD"), // 10 shares @ 100 USD = 1000 USD
        EURX1: quote("EURX1", "100", "EUR"), // 10 shares @ 100 EUR = 1000 EUR
      },
    });

    const auth = createAuth(tdb.db, testEnv);
    const appWithFx = createApp(tdb.db, providerWithBoth, auth, undefined, fxStub);
    const freshCookie = await signUpTestUser(appWithFx, "view-fx@example.com");

    // Get the fresh user's portfolio
    const usersByEmail = await tdb.db
      .select()
      .from(user)
      .where(eq(user.email, "view-fx@example.com"));
    const freshUserId = usersByEmail[0]!.id;
    const freshUserPortfolios = await tdb.db
      .select()
      .from(portfolio)
      .where(eq(portfolio.userId, freshUserId));
    const freshPortfolioId = freshUserPortfolios[0]!.id;

    // Seed transactions
    await postTx(appWithFx, freshCookie, {
      instrument: {
        symbol: "USDX1",
        name: "USD Test",
        exchange: "XNAS",
        currency: "USD",
        assetType: "stock",
      },
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "2026-01-01",
    });
    await postTx(appWithFx, freshCookie, {
      instrument: {
        symbol: "EURX1",
        name: "EUR Test",
        exchange: "XNAS",
        currency: "EUR",
        assetType: "stock",
      },
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "2026-01-01",
    });

    // Create category for the EUR holding
    const [eurCategory] = await tdb.db
      .insert(category)
      .values({ portfolioId: freshPortfolioId, name: "Europe", targetPct: "70", position: 0 })
      .returning();
    await tdb.db.insert(categoryAssignment).values({
      portfolioId: freshPortfolioId,
      symbol: "EURX1",
      categoryId: eurCategory!.id,
    });
    // USDX1 left unallocated

    const res = await appWithFx.request("/categories/view?currency=USD", {
      headers: { cookie: freshCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;

    // EUR value: 1000 EUR / 0.5 = 2000 USD
    expect(body.root.children).toHaveLength(1);
    const eurCat = body.root.children[0]!;
    expect(eurCat.name).toBe("Europe");
    expect(eurCat.value).toEqual({ amount: "2000.00", currency: "USD" });
    expect(eurCat.actualPct).toBe(66.67);

    // Totals: 1000 USD + 2000 USD (converted EUR) = 3000 USD
    expect(body.totals.value).toEqual({ amount: "3000.00", currency: "USD" });

    // Unallocated USD: 1000 / 3000 = 33.33%
    expect(body.unallocated).toHaveLength(1);
    expect(body.unallocated[0]!.symbol).toBe("USDX1");
    expect(body.unallocated[0]!.weightPct).toBe(33.33);
    expect(body.fxIncomplete).toBe(false);
  });

  it("flags fxIncomplete and passes values through when no rates are available", async () => {
    const emptyFxStub: IFxRateService = {
      getRate: () => Promise.reject(new Error("FX rate unavailable")),
      getRates: () => Promise.resolve(new Map()),
    };
    const providerWithBoth = new FakeMarketDataProvider({
      quotes: {
        USDX2: quote("USDX2", "100", "USD"), // 10 shares @ 100 USD = 1000 USD
        EURX2: quote("EURX2", "100", "EUR"), // 10 shares @ 100 EUR = 1000 EUR
      },
    });

    const auth = createAuth(tdb.db, testEnv);
    const appNoFx = createApp(tdb.db, providerWithBoth, auth, undefined, emptyFxStub);
    const freshCookie = await signUpTestUser(appNoFx, "view-fx-cold@example.com");

    await postTx(appNoFx, freshCookie, {
      instrument: {
        symbol: "USDX2",
        name: "USD Test 2",
        exchange: "XNAS",
        currency: "USD",
        assetType: "stock",
      },
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "2026-01-01",
    });
    await postTx(appNoFx, freshCookie, {
      instrument: {
        symbol: "EURX2",
        name: "EUR Test 2",
        exchange: "XNAS",
        currency: "EUR",
        assetType: "stock",
      },
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "2026-01-01",
    });

    const res = await appNoFx.request("/categories/view?currency=USD", {
      headers: { cookie: freshCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;

    expect(body.fxIncomplete).toBe(true);
    // EUR value passes through unconverted (1000), labeled USD — totals 2000.
    expect(body.totals.value).toEqual({ amount: "2000.00", currency: "USD" });
  });
});

describeDb("PUT /categories", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();
    const provider = new FakeMarketDataProvider({
      quotes: { AAPL3: quote("AAPL3", "200", "USD"), MSFT3: quote("MSFT3", "100", "USD") },
    });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUpTestUser(app, "put-user@example.com");
    await postTx(app, cookie, {
      instrument: {
        symbol: "AAPL3",
        name: "Apple",
        exchange: "XNAS",
        currency: "USD",
        assetType: "stock",
      },
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "2026-01-01",
    });
    await postTx(app, cookie, {
      instrument: {
        symbol: "MSFT3",
        name: "Microsoft",
        exchange: "XNAS",
        currency: "USD",
        assetType: "stock",
      },
      type: "buy",
      quantity: "10",
      price: "100",
      tradeDate: "2026-01-01",
    });
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  async function put(body: unknown, c = cookie) {
    return app.request("/categories", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: c },
      body: JSON.stringify(body),
    });
  }

  it("creates categories and assignments and returns the fresh view", async () => {
    const res = await put({
      categories: [{ name: "Growth", targetPct: 60, holdings: [{ symbol: "AAPL3" }] }],
      rootHoldings: [{ symbol: "MSFT3", targetPct: 40 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;
    expect(body.root.children).toHaveLength(1);
    expect(body.root.children[0]!.name).toBe("Growth");
    expect(body.root.children[0]!.holdings.map((h: { symbol: string }) => h.symbol)).toEqual([
      "AAPL3",
    ]);
    expect(body.root.holdings[0]!.symbol).toBe("MSFT3");
    expect(body.unallocated).toEqual([]);
  });

  it("updates by id, deletes missing categories, and reassigns", async () => {
    const before = (await (
      await app.request("/categories/view", { headers: { cookie } })
    ).json()) as CategoriesViewBody;
    const growthId = before.root.children[0]!.id;

    const res = await put({
      // Growth renamed + retargeted, now holds MSFT3; AAPL3 back to unallocated.
      // No other categories in payload -> none deleted here besides implicit none.
      categories: [
        { id: growthId, name: "Momentum", targetPct: 50, holdings: [{ symbol: "MSFT3" }] },
      ],
      rootHoldings: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;
    expect(body.root.children).toHaveLength(1);
    expect(body.root.children[0]!.id).toBe(growthId);
    expect(body.root.children[0]!.name).toBe("Momentum");
    expect(body.root.children[0]!.targetPct).toBe(50);
    expect(body.root.children[0]!.holdings.map((h: { symbol: string }) => h.symbol)).toEqual([
      "MSFT3",
    ]);
    expect(body.unallocated.map((h: { symbol: string }) => h.symbol)).toEqual(["AAPL3"]);

    // Now send an empty structure -> category deleted, everything unallocated
    const res2 = await put({ categories: [], rootHoldings: [] });
    const body2 = (await res2.json()) as CategoriesViewBody;
    expect(body2.root.children).toEqual([]);
    expect(body2.unallocated.map((h) => h.symbol).sort()).toEqual(["AAPL3", "MSFT3"]);
  });

  it("survives swapping two category names in one save", async () => {
    const first = await put({
      categories: [
        { name: "Alpha", targetPct: null, holdings: [{ symbol: "AAPL3" }] },
        { name: "Beta", targetPct: null, holdings: [{ symbol: "MSFT3" }] },
      ],
      rootHoldings: [],
    });
    const ids = ((await first.json()) as CategoriesViewBody).root.children.map(
      (c: { id: string }) => c.id,
    );

    const res = await put({
      categories: [
        { id: ids[0], name: "Beta", targetPct: null, holdings: [{ symbol: "AAPL3" }] },
        { id: ids[1], name: "Alpha", targetPct: null, holdings: [{ symbol: "MSFT3" }] },
      ],
      rootHoldings: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;
    expect(body.root.children.map((c: { name: string }) => c.name)).toEqual(["Beta", "Alpha"]);
  });

  it("silently drops symbols that are not currently held", async () => {
    const res = await put({
      categories: [
        {
          name: "Ghosts",
          targetPct: null,
          holdings: [{ symbol: "AAPL3" }, { symbol: "NOT_HELD" }],
        },
      ],
      rootHoldings: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;
    expect(body.root.children[0]!.holdings.map((h: { symbol: string }) => h.symbol)).toEqual([
      "AAPL3",
    ]);
  });

  it("rejects duplicate names, duplicate symbols, and bad targets with 400", async () => {
    const dupName = await put({
      categories: [
        { name: "Same", targetPct: null, holdings: [] },
        { name: "Same", targetPct: null, holdings: [] },
      ],
      rootHoldings: [],
    });
    expect(dupName.status).toBe(400);

    const dupSymbol = await put({
      categories: [
        { name: "A", targetPct: null, holdings: [{ symbol: "AAPL3" }] },
        { name: "B", targetPct: null, holdings: [{ symbol: "AAPL3" }] },
      ],
      rootHoldings: [],
    });
    expect(dupSymbol.status).toBe(400);

    const badTarget = await put({
      categories: [{ name: "C", targetPct: 150, holdings: [] }],
      rootHoldings: [],
    });
    expect(badTarget.status).toBe(400);

    const emptyName = await put({
      categories: [{ name: "  ", targetPct: null, holdings: [] }],
      rootHoldings: [],
    });
    expect(emptyName.status).toBe(400);

    const notJson = await put(["not", "an", "object"]);
    expect(notJson.status).toBe(400);

    // A non-string id is a malformed payload (400), not a missing category (404).
    const badId = await put({
      categories: [{ id: 42, name: "D", targetPct: null, holdings: [] }],
      rootHoldings: [],
    });
    expect(badId.status).toBe(400);

    const negativeTarget = await put({
      categories: [{ name: "E", targetPct: -5, holdings: [] }],
      rootHoldings: [],
    });
    expect(negativeTarget.status).toBe(400);
  });

  it("orders categories by payload position and holdings by value descending", async () => {
    const ordered = await put({
      categories: [
        { name: "Zeta", targetPct: null, holdings: [{ symbol: "MSFT3" }] },
        { name: "Alpha", targetPct: null, holdings: [{ symbol: "AAPL3" }] },
      ],
      rootHoldings: [],
    });
    expect(ordered.status).toBe(200);
    const orderedBody = (await ordered.json()) as CategoriesViewBody;
    // Payload position wins, not alphabetical order and not value order.
    expect(orderedBody.root.children.map((c) => c.name)).toEqual(["Zeta", "Alpha"]);

    const combined = await put({
      categories: [
        { name: "Both", targetPct: null, holdings: [{ symbol: "MSFT3" }, { symbol: "AAPL3" }] },
      ],
      rootHoldings: [],
    });
    expect(combined.status).toBe(200);
    const combinedBody = (await combined.json()) as CategoriesViewBody;
    // AAPL3 ($2000) outranks MSFT3 ($1000) despite payload order.
    expect(combinedBody.root.children[0]!.holdings.map((h) => h.symbol)).toEqual([
      "AAPL3",
      "MSFT3",
    ]);
  });

  it("is atomic: a failing payload leaves the previous structure untouched", async () => {
    await put({
      categories: [{ name: "Kept", targetPct: 10, holdings: [{ symbol: "AAPL3" }] }],
      rootHoldings: [],
    });
    // Duplicate name triggers validation failure -> 400, nothing written
    const res = await put({
      categories: [
        { name: "New1", targetPct: null, holdings: [{ symbol: "MSFT3" }] },
        { name: "New1", targetPct: null, holdings: [] },
      ],
      rootHoldings: [],
    });
    expect(res.status).toBe(400);
    const view = (await (
      await app.request("/categories/view", { headers: { cookie } })
    ).json()) as CategoriesViewBody;
    expect(view.root.children.map((c: { name: string }) => c.name)).toEqual(["Kept"]);
    expect(view.root.children[0]!.holdings.map((h: { symbol: string }) => h.symbol)).toEqual([
      "AAPL3",
    ]);
  });

  it("rolls value up through a nested tree and scales each level to its parent", async () => {
    const res = await put({
      categories: [
        {
          name: "Core",
          targetPct: 100,
          // Holds nothing directly: everything below is in its children, which
          // is exactly the case a non-rolled-up parent would report as zero.
          holdings: [],
          children: [
            { name: "Equities", targetPct: 70, holdings: [{ symbol: "AAPL3" }] },
            { name: "Software", targetPct: 30, holdings: [{ symbol: "MSFT3" }] },
          ],
        },
      ],
      rootHoldings: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;

    const core = body.root.children[0]!;
    expect(core.name).toBe("Core");
    expect(core.value).toEqual({ amount: "3000.00", currency: "USD" });
    expect(core.invested).toEqual({ amount: "2000.00", currency: "USD" });
    // Core is the whole portfolio, so its share of the root is 100.
    expect(core.actualPct).toBe(100);
    // Two children and no direct holdings.
    expect(core.itemCount).toBe(2);

    // A child's actual is its share of ITS PARENT, not of the portfolio.
    const equities = core.children.find((c) => c.name === "Equities")!;
    const software = core.children.find((c) => c.name === "Software")!;
    expect(equities.actualPct).toBe(66.67); // 2000 / 3000
    expect(software.actualPct).toBe(33.33); // 1000 / 3000
    expect(equities.actualPct + software.actualPct).toBeCloseTo(100, 1);

    // And a holding's weight is its share of the category holding it.
    expect(equities.holdings[0]!.weightPct).toBe(100);

    // Only root-level targets count toward the headline sum; Core's children
    // target shares of Core, not of the portfolio.
    expect(body.totals.targetPctSum).toBe(100);
  });

  it("stores a per-asset target inside a category", async () => {
    const res = await put({
      categories: [
        {
          name: "Split",
          targetPct: null,
          holdings: [
            { symbol: "AAPL3", targetPct: 60 },
            { symbol: "MSFT3", targetPct: 40 },
          ],
        },
      ],
      rootHoldings: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;
    const split = body.root.children[0]!;
    expect(split.holdings.map((h) => [h.symbol, h.targetPct])).toEqual([
      ["AAPL3", 60],
      ["MSFT3", 40],
    ]);
    // Actual is measured against the category, not the portfolio.
    expect(split.holdings.map((h) => h.weightPct)).toEqual([66.67, 33.33]);
  });

  it("accepts a repeated name under different parents", async () => {
    const res = await put({
      categories: [
        {
          name: "Left",
          targetPct: null,
          holdings: [],
          children: [{ name: "Bonds", targetPct: null, holdings: [{ symbol: "AAPL3" }] }],
        },
        {
          name: "Right",
          targetPct: null,
          holdings: [],
          children: [{ name: "Bonds", targetPct: null, holdings: [{ symbol: "MSFT3" }] }],
        },
      ],
      rootHoldings: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;
    expect(body.root.children.map((c) => c.children[0]!.name)).toEqual(["Bonds", "Bonds"]);
  });

  it("rejects the same category appearing twice in the tree", async () => {
    const seeded = await put({
      categories: [
        { name: "One", targetPct: null, holdings: [] },
        { name: "Two", targetPct: null, holdings: [] },
      ],
      rootHoldings: [],
    });
    const ids = ((await seeded.json()) as CategoriesViewBody).root.children.map((c) => c.id);

    // The only way a nested payload can describe a cycle: name an existing
    // category in two places, so the second write decides its parent.
    const res = await put({
      categories: [
        {
          id: ids[0],
          name: "One",
          targetPct: null,
          holdings: [],
          children: [
            {
              id: ids[1],
              name: "Two",
              targetPct: null,
              holdings: [],
              children: [{ id: ids[0], name: "One again", targetPct: null, holdings: [] }],
            },
          ],
        },
      ],
      rootHoldings: [],
    });
    expect(res.status).toBe(400);
  });

  it("keeps a child that moved to the root while its old parent was deleted", async () => {
    const seeded = await put({
      categories: [
        {
          name: "OldParent",
          targetPct: null,
          holdings: [],
          children: [{ name: "Survivor", targetPct: null, holdings: [{ symbol: "AAPL3" }] }],
        },
      ],
      rootHoldings: [],
    });
    const survivorId = ((await seeded.json()) as CategoriesViewBody).root.children[0]!.children[0]!
      .id;

    // OldParent is gone from the payload and Survivor has moved to the root.
    // `parent_id` cascades, so the delete must not reach a row the payload keeps.
    const res = await put({
      categories: [
        { id: survivorId, name: "Survivor", targetPct: null, holdings: [{ symbol: "AAPL3" }] },
      ],
      rootHoldings: [],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesViewBody;
    expect(body.root.children).toHaveLength(1);
    expect(body.root.children[0]!.id).toBe(survivorId);
    expect(body.root.children[0]!.holdings.map((h) => h.symbol)).toEqual(["AAPL3"]);
  });

  it("404s on a category id belonging to another user", async () => {
    const otherCookie = await signUpTestUser(app, "put-other@example.com");
    const view = (await (
      await app.request("/categories/view", { headers: { cookie } })
    ).json()) as CategoriesViewBody;
    const foreignId = view.root.children[0]!.id;
    const res = await put(
      {
        categories: [{ id: foreignId, name: "Steal", targetPct: null, holdings: [] }],
        rootHoldings: [],
      },
      otherCookie,
    );
    expect(res.status).toBe(404);
  });
});
