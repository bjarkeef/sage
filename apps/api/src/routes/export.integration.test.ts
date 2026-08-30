import { it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth, getUserPortfolio } from "../auth";
import { customHolding, instrument, manualPrice, transaction, user } from "../db/schema";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** The identity mapping: our headers are already the importer's field names. */
const IDENTITY_MAPPING = JSON.stringify({
  symbol: "symbol",
  type: "type",
  quantity: "quantity",
  price: "price",
  currency: "currency",
  tradeDate: "tradeDate",
  fee: "fee",
  feeCurrency: "feeCurrency",
  exchange: "exchange",
  name: "name",
});

describeDb("export routes", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;
  let otherCookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, new FakeMarketDataProvider(), auth);

    cookie = await signUpTestUser(app, "exporter@example.com");
    const [u] = await tdb.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "exporter@example.com"));
    const { id: portfolioId } = await getUserPortfolio(tdb.db, u!.id);

    await tdb.db.insert(instrument).values({
      symbol: "O",
      name: "Realty Income",
      exchange: "NYSE",
      currency: "USD",
      assetType: "stock",
    });
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "O",
      type: "buy",
      quantity: "10",
      price: "55.5",
      currency: "USD",
      tradeDate: daysAgo(30),
    });

    // A second user with their own holding — nothing of theirs may appear.
    otherCookie = await signUpTestUser(app, "other@example.com");
    const [o] = await tdb.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "other@example.com"));
    const { id: otherPortfolioId } = await getUserPortfolio(tdb.db, o!.id);
    await tdb.db.insert(instrument).values({
      symbol: "SECRET",
      name: "Other Person Holding",
      exchange: "NYSE",
      currency: "USD",
      assetType: "stock",
    });
    await tdb.db.insert(transaction).values({
      portfolioId: otherPortfolioId,
      instrumentSymbol: "SECRET",
      type: "buy",
      quantity: "1",
      price: "1",
      currency: "USD",
      tradeDate: daysAgo(5),
    });

    // A custom holding + manual price mark that belong to the OTHER user, and
    // a transaction the FIRST user posts against that same symbol — the
    // scenario ensureInstrument() allows (it updates, never rejects, an
    // existing symbol). manual_price has no portfolio_id column, so the
    // export must scope by customHolding ownership, not by "symbol appears
    // somewhere in my transactions".
    await tdb.db.insert(instrument).values({
      symbol: "XCUSTOM",
      name: "Other Person's Custom Holding",
      exchange: "CUSTOM",
      currency: "USD",
      assetType: "custom",
    });
    await tdb.db.insert(customHolding).values({
      symbol: "XCUSTOM",
      portfolioId: otherPortfolioId,
    });
    await tdb.db.insert(manualPrice).values({
      symbol: "XCUSTOM",
      date: daysAgo(1),
      price: "42.42",
      currency: "USD",
    });
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "XCUSTOM",
      type: "buy",
      quantity: "1",
      price: "1",
      currency: "USD",
      tradeDate: daysAgo(2),
    });
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("requires authentication", async () => {
    expect((await app.request("/export/transactions.csv")).status).toBe(401);
    expect((await app.request("/export/data.json")).status).toBe(401);
  });

  it("serves a CSV with the importer's column names and a download filename", async () => {
    const res = await app.request("/export/transactions.csv", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="sage-transactions-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const text = await res.text();
    expect(text.split("\n")[0]).toBe(
      "symbol,type,quantity,price,currency,tradeDate,fee,feeCurrency,exchange,name,source",
    );
    expect(text).toContain("O,buy,10,55.5,USD,");
  });

  it("exports just the header row for an empty portfolio", async () => {
    // Papa.unparse's (data, config) form short-circuits to "" on an empty
    // array and never consults `columns` — a fresh self-hoster who exports
    // before importing anything must still get a header, since Sage's own
    // importer rejects a file with no headers at all.
    const emptyCookie = await signUpTestUser(app, "empty-exporter@example.com");
    const res = await app.request("/export/transactions.csv", { headers: { cookie: emptyCookie } });
    expect(res.status).toBe(200);
    const text = await res.text();

    const populated = await (
      await app.request("/export/transactions.csv", { headers: { cookie } })
    ).text();
    const header = populated.split("\n")[0];

    // Papa.unparse's object form trails the header with a newline when there
    // are no data rows to follow (unlike the populated case, where the last
    // data row has no trailing newline) — strip it so this compares content,
    // not that incidental formatting difference.
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toEqual([header]);
  });

  it("produces byte-identical CSV across consecutive exports", async () => {
    const a = await (await app.request("/export/transactions.csv", { headers: { cookie } })).text();
    const b = await (await app.request("/export/transactions.csv", { headers: { cookie } })).text();
    expect(a).toBe(b);
  });

  it("serves the JSON export with a download filename", async () => {
    const res = await app.request("/export/data.json", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="sage-export-\d{4}-\d{2}-\d{2}\.json"/,
    );
    const body = (await res.json()) as { version: number; transactions: unknown[] };
    expect(body.version).toBe(1);
    expect(body.transactions).toHaveLength(2);
  });

  it("never leaks another user's data", async () => {
    const csv = await (
      await app.request("/export/transactions.csv", { headers: { cookie } })
    ).text();
    expect(csv).not.toContain("SECRET");
    const json = await (await app.request("/export/data.json", { headers: { cookie } })).text();
    expect(json).not.toContain("SECRET");

    // And the other direction, so the test cannot pass by exporting nothing.
    const theirs = await (
      await app.request("/export/transactions.csv", { headers: { cookie: otherCookie } })
    ).text();
    expect(theirs).toContain("SECRET");
    expect(theirs).not.toContain("Realty Income");
  });

  it("never leaks another tenant's manual price marks through a shared symbol", async () => {
    // The first user has a transaction against "XCUSTOM", a symbol whose
    // custom holding (and manual price) belong to the OTHER user. The export
    // must not surface that price mark just because the symbol shows up in
    // this user's own transactions.
    const body = (await (
      await app.request("/export/data.json", { headers: { cookie } })
    ).json()) as { manualPrices: { symbol: string; price: string }[] };
    expect(body.manualPrices.some((p) => p.symbol === "XCUSTOM")).toBe(false);
    expect(body.manualPrices.some((p) => p.price === "42.42")).toBe(false);

    // And the mark is still visible to the user who actually owns it.
    const theirs = (await (
      await app.request("/export/data.json", { headers: { cookie: otherCookie } })
    ).json()) as { manualPrices: { symbol: string; price: string }[] };
    expect(theirs.manualPrices.some((p) => p.symbol === "XCUSTOM" && p.price === "42.42")).toBe(
      true,
    );
  });

  it("round-trips: the exported CSV imports back through the generic importer", async () => {
    const csv = await (
      await app.request("/export/transactions.csv", { headers: { cookie } })
    ).text();

    // Import into the SECOND user's portfolio, so success is visible as new
    // rows there rather than being masked by the originals.
    const fd = new FormData();
    fd.append("file", new File([csv], "export.csv", { type: "text/csv" }));
    fd.append("mapping", IDENTITY_MAPPING);
    const res = await app.request("/import/csv/commit", {
      method: "POST",
      headers: { cookie: otherCookie },
      body: fd,
    });
    expect(res.status).toBe(200);

    const theirs = await (
      await app.request("/export/transactions.csv", { headers: { cookie: otherCookie } })
    ).text();
    expect(theirs).toContain("O,buy,10,55.5,USD,");
  });

  it("round-trips a price-0 buy (e.g. a reinvested custom-income buy) through export -> import -> export", async () => {
    const [u] = await tdb.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "exporter@example.com"));
    const { id: portfolioId } = await getUserPortfolio(tdb.db, u!.id);
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "O",
      type: "buy",
      quantity: "0.47",
      price: "0",
      currency: "USD",
      source: "custom-income",
      tradeDate: daysAgo(3),
    });

    const csv = await (
      await app.request("/export/transactions.csv", { headers: { cookie } })
    ).text();
    expect(csv).toContain("O,buy,0.47,0,USD,");

    const fd = new FormData();
    fd.append("file", new File([csv], "export.csv", { type: "text/csv" }));
    fd.append("mapping", IDENTITY_MAPPING);
    const res = await app.request("/import/csv/commit", {
      method: "POST",
      headers: { cookie: otherCookie },
      body: fd,
    });
    expect(res.status).toBe(200);

    const theirs = await (
      await app.request("/export/transactions.csv", { headers: { cookie: otherCookie } })
    ).text();
    expect(theirs).toContain("O,buy,0.47,0,USD,");
  });
});
