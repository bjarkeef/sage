import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { getUserPortfolio } from "../auth";
import { instrument, transaction, category, categoryAssignment, goal, user } from "../db/schema";
import { buildTransactionRows, buildExport, type ExportDocument } from "./export-view";

/** Relative dates only — a hardcoded date here rots into a false failure. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describeDb("export view", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let userId: string;
  let portfolioId: string;

  beforeAll(async () => {
    tdb = await withTestDb();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, new FakeMarketDataProvider(), auth);
    await signUpTestUser(app, "export-view@example.com");

    const [u] = await tdb.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "export-view@example.com"));
    userId = u!.id;
    ({ id: portfolioId } = await getUserPortfolio(tdb.db, userId));

    await tdb.db.insert(instrument).values([
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        exchange: "NASDAQ",
        currency: "USD",
        assetType: "stock",
        isin: "US0378331005",
      },
      { symbol: "O", name: "Realty Income", exchange: "NYSE", currency: "USD", assetType: "stock" },
    ]);

    await tdb.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "O",
        type: "buy",
        quantity: "10",
        price: "55.5",
        currency: "USD",
        tradeDate: daysAgo(30),
      },
      {
        portfolioId,
        instrumentSymbol: "AAPL",
        type: "buy",
        quantity: "5",
        price: "180.25",
        currency: "USD",
        fee: "1.5",
        feeCurrency: "USD",
        tradeDate: daysAgo(60),
      },
      {
        portfolioId,
        instrumentSymbol: "O",
        type: "dividend",
        quantity: "10",
        price: "0.26",
        currency: "USD",
        source: "auto",
        tradeDate: daysAgo(10),
      },
      {
        portfolioId,
        instrumentSymbol: "O",
        type: "buy",
        quantity: "0.47",
        price: "0",
        currency: "USD",
        source: "custom-income",
        tradeDate: daysAgo(9),
      },
    ]);

    const [cat] = await tdb.db
      .insert(category)
      .values({ portfolioId, name: "Core", targetPct: "60", position: 0 })
      .returning({ id: category.id });
    await tdb.db
      .insert(categoryAssignment)
      .values({ portfolioId, symbol: "O", categoryId: cat!.id });
    await tdb.db.insert(goal).values({
      portfolioId,
      type: "passive_income",
      amount: "24000.00",
      currency: "USD",
      targetYear: new Date().getUTCFullYear() + 10,
    });
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  describe("buildTransactionRows", () => {
    it("returns one row per transaction with instrument metadata joined in", async () => {
      const rows = await buildTransactionRows(tdb.db, userId);
      expect(rows).toHaveLength(4);
      const aapl = rows.find((r) => r.symbol === "AAPL")!;
      expect(aapl).toMatchObject({
        type: "buy",
        quantity: "5",
        price: "180.25",
        currency: "USD",
        fee: "1.5",
        feeCurrency: "USD",
        exchange: "NASDAQ",
        name: "Apple Inc.",
        source: "",
      });
    });

    // `source` is not two-valued: "auto" (reconciliation), "custom-income"
    // (the custom-holding income engine), and "" (user-entered/imported) all
    // occur. This asserts each is marked correctly without implying those
    // are the only three values the column can ever carry.
    it("marks auto-reconciled and custom-income rows, and leaves user rows blank", async () => {
      const rows = await buildTransactionRows(tdb.db, userId);
      expect(rows.filter((r) => r.source === "auto")).toHaveLength(1);
      expect(rows.filter((r) => r.source === "custom-income")).toHaveLength(1);
      expect(rows.filter((r) => r.source === "")).toHaveLength(2);
    });

    it("uses empty strings, never null, so the CSV writer cannot emit 'null'", async () => {
      const rows = await buildTransactionRows(tdb.db, userId);
      for (const row of rows) {
        for (const value of Object.values(row)) {
          expect(typeof value).toBe("string");
        }
      }
    });

    it("is deterministic across calls", async () => {
      const a = await buildTransactionRows(tdb.db, userId);
      const b = await buildTransactionRows(tdb.db, userId);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("orders oldest trade first", async () => {
      const rows = await buildTransactionRows(tdb.db, userId);
      const dates = rows.map((r) => r.tradeDate);
      expect([...dates].sort()).toEqual(dates);
    });
  });

  describe("buildExport", () => {
    it("carries every user-authored collection", async () => {
      const doc = await buildExport(tdb.db, userId);
      expect(doc.version).toBe(1);
      expect(doc.portfolio.name).toBe("Default");
      expect(doc.transactions).toHaveLength(4);
      expect(doc.instruments.map((i) => i.symbol).sort()).toEqual(["AAPL", "O"]);
      expect(doc.categories).toHaveLength(1);
      expect(doc.categoryAssignments).toHaveLength(1);
      expect(doc.goals).toHaveLength(1);
    });

    it("keeps money as strings, so no precision is lost through JSON", async () => {
      const doc = await buildExport(tdb.db, userId);
      const serialized = JSON.parse(JSON.stringify(doc)) as ExportDocument;
      const tx = serialized.transactions.find((t) => t.symbol === "AAPL")!;
      expect(tx.price).toBe("180.25");
      expect(typeof tx.price).toBe("string");
      expect(typeof tx.quantity).toBe("string");
      expect(serialized.goals[0]!.amount).toBe("24000.00");
      expect(serialized.categories[0]!.targetPct).toBe("60");
    });

    it("carries exactly the user-authored collections, no provider-cache collections", async () => {
      const doc = await buildExport(tdb.db, userId);
      // Exact-keys, not absence-of-forbidden-names: a new cache collection
      // added later must fail this test by simply not being in the list,
      // rather than requiring someone to remember to blocklist it here too.
      expect(Object.keys(doc).sort()).toEqual(
        [
          "version",
          "exportedAt",
          "portfolio",
          "user",
          "instruments",
          "transactions",
          "customHoldings",
          "manualPrices",
          "categories",
          "categoryAssignments",
          "goals",
        ].sort(),
      );
    });

    it("is byte-identical across calls when nothing changed", async () => {
      const clock = () => new Date("2026-08-10T00:00:00.000Z");
      const a = JSON.stringify(await buildExport(tdb.db, userId, clock));
      const b = JSON.stringify(await buildExport(tdb.db, userId, clock));
      expect(a).toBe(b);
    });
  });
});
