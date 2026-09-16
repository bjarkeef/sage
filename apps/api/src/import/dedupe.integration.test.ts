import { it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { user, portfolio, instrument, transaction, importRow, customIncome } from "../db/schema";
import { planImport, executeImport } from "./dedupe";
import type { ImportTransaction } from "./types";

function tx(overrides: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    symbol: "AAPL",
    type: "buy",
    quantity: "10",
    price: "100",
    currency: "USD",
    tradeDate: "2026-01-01",
    fee: null,
    feeCurrency: null,
    exchange: "NASDAQ",
    rowNumber: 2,
    ...overrides,
  };
}

describeDb("planImport / executeImport", () => {
  let tdb: TestDb;
  let portfolioId: string;

  beforeAll(async () => {
    tdb = await withTestDb();
    await tdb.db.insert(user).values({ id: "u1", name: "Test", email: "t@example.com" });
    const [p] = await tdb.db
      .insert(portfolio)
      .values({ userId: "u1" })
      .returning({ id: portfolio.id });
    portfolioId = p!.id;
    await tdb.db.insert(instrument).values([
      { symbol: "AAPL", name: "Apple", exchange: "NASDAQ", currency: "USD", assetType: "stock" },
      {
        symbol: "MSFT",
        name: "Microsoft",
        exchange: "NASDAQ",
        currency: "USD",
        assetType: "stock",
      },
      { symbol: "NVDA", name: "Nvidia", exchange: "NASDAQ", currency: "USD", assetType: "stock" },
    ]);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("plans insert for unseen rows, then already-imported after execution", async () => {
    const rows = [tx()];
    const plan1 = await planImport(tdb.db, portfolioId, rows);
    expect(plan1.map((r) => r.disposition)).toEqual(["insert"]);

    const result = await executeImport(tdb.db, portfolioId, "snowball", plan1, {
      restoreDeleted: false,
    });
    expect(result.inserted).toBe(1);
    expect(result.syncSymbols).toEqual(["AAPL"]);

    const plan2 = await planImport(tdb.db, portfolioId, rows);
    expect(plan2.map((r) => r.disposition)).toEqual(["already-imported"]);

    const result2 = await executeImport(tdb.db, portfolioId, "snowball", plan2, {
      restoreDeleted: false,
    });
    expect(result2.inserted).toBe(0);
    expect(result2.alreadyImported).toBe(1);
  });

  it("re-plans already-imported even when the transaction was edited", async () => {
    // Edit the AAPL transaction's price: the ledger entry still points at it.
    const [row] = await tdb.db
      .select({ id: transaction.id })
      .from(transaction)
      .where(eq(transaction.instrumentSymbol, "AAPL"));
    await tdb.db.update(transaction).set({ price: "123" }).where(eq(transaction.id, row!.id));

    const plan = await planImport(tdb.db, portfolioId, [tx()]);
    expect(plan.map((r) => r.disposition)).toEqual(["already-imported"]);
  });

  it("claims an unclaimed content-matching transaction instead of inserting", async () => {
    // Manual entry with different decimal formatting, no ledger row.
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "MSFT",
      type: "buy",
      quantity: "5.00",
      price: "200.0",
      currency: "USD",
      tradeDate: "2026-02-01",
    });

    const csvRow = tx({ symbol: "MSFT", quantity: "5", price: "200", tradeDate: "2026-02-01" });
    const plan = await planImport(tdb.db, portfolioId, [csvRow]);
    expect(plan.map((r) => r.disposition)).toEqual(["claim-existing"]);
    expect(plan[0]!.claimTransactionId).toBeDefined();

    const result = await executeImport(tdb.db, portfolioId, "snowball", plan, {
      restoreDeleted: false,
    });
    expect(result.claimed).toBe(1);
    expect(result.inserted).toBe(0);

    // Ledger row points at the manual transaction; MSFT count is still 1.
    const msft = await tdb.db
      .select({ id: transaction.id })
      .from(transaction)
      .where(eq(transaction.instrumentSymbol, "MSFT"));
    expect(msft).toHaveLength(1);
    const ledger = await tdb.db
      .select({ transactionId: importRow.transactionId })
      .from(importRow)
      .where(eq(importRow.transactionId, msft[0]!.id));
    expect(ledger).toHaveLength(1);
  });

  it("tombstones deleted transactions; restore re-inserts and re-links", async () => {
    const rows = [tx({ symbol: "NVDA", quantity: "3", price: "500", tradeDate: "2026-03-01" })];
    await executeImport(
      tdb.db,
      portfolioId,
      "snowball",
      await planImport(tdb.db, portfolioId, rows),
      {
        restoreDeleted: false,
      },
    );

    // Delete the transaction: FK SET NULL leaves the tombstone.
    await tdb.db.delete(transaction).where(eq(transaction.instrumentSymbol, "NVDA"));

    const plan = await planImport(tdb.db, portfolioId, rows);
    expect(plan.map((r) => r.disposition)).toEqual(["tombstoned"]);
    expect(plan[0]!.ledgerId).toBeDefined();

    // Without the flag: stays deleted.
    const skip = await executeImport(tdb.db, portfolioId, "snowball", plan, {
      restoreDeleted: false,
    });
    expect(skip.tombstonedSkipped).toBe(1);
    expect(
      await tdb.db.select().from(transaction).where(eq(transaction.instrumentSymbol, "NVDA")),
    ).toHaveLength(0);

    // With the flag: restored and re-linked.
    const plan2 = await planImport(tdb.db, portfolioId, rows);
    const restore = await executeImport(tdb.db, portfolioId, "snowball", plan2, {
      restoreDeleted: true,
    });
    expect(restore.restored).toBe(1);
    expect(restore.syncSymbols).toEqual(["NVDA"]);
    const restored = await tdb.db
      .select({ id: transaction.id })
      .from(transaction)
      .where(eq(transaction.instrumentSymbol, "NVDA"));
    expect(restored).toHaveLength(1);
    const ledger = await tdb.db
      .select({ transactionId: importRow.transactionId })
      .from(importRow)
      .where(eq(importRow.transactionId, restored[0]!.id));
    expect(ledger).toHaveLength(1);
  });

  it("multiset: two identical CSV rows with one matching manual transaction → 1 claim + 1 insert", async () => {
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "AAPL",
      type: "sell",
      quantity: "2",
      price: "150",
      currency: "USD",
      tradeDate: "2026-04-01",
    });
    const row = tx({ type: "sell", quantity: "2", price: "150", tradeDate: "2026-04-01" });
    const plan = await planImport(tdb.db, portfolioId, [row, row]);
    expect(plan.map((r) => r.disposition).sort()).toEqual(["claim-existing", "insert"]);

    const result = await executeImport(tdb.db, portfolioId, "snowball", plan, {
      restoreDeleted: false,
    });
    expect(result.claimed).toBe(1);
    expect(result.inserted).toBe(1);
  });

  // A stale plan — computed before another commit landed — is exactly what a
  // losing racer executes. Re-executing one deterministically drives the
  // ON CONFLICT / lost-race branches that sequential re-planning never reaches.
  it("re-executing a stale insert plan never double-writes", async () => {
    await tdb.db.insert(instrument).values({
      symbol: "TSLA",
      name: "Tesla",
      exchange: "NASDAQ",
      currency: "USD",
      assetType: "stock",
    });
    const rows = [tx({ symbol: "TSLA", quantity: "7", price: "300", tradeDate: "2026-05-01" })];
    const plan = await planImport(tdb.db, portfolioId, rows);
    expect(plan.map((r) => r.disposition)).toEqual(["insert"]);

    const first = await executeImport(tdb.db, portfolioId, "snowball", plan, {
      restoreDeleted: false,
    });
    expect(first.inserted).toBe(1);

    const second = await executeImport(tdb.db, portfolioId, "snowball", plan, {
      restoreDeleted: false,
    });
    expect(second.inserted).toBe(0);
    expect(second.alreadyImported).toBe(1);
    expect(
      await tdb.db.select().from(transaction).where(eq(transaction.instrumentSymbol, "TSLA")),
    ).toHaveLength(1);
  });

  it("re-executing a stale restore plan rolls back its duplicate insert", async () => {
    await tdb.db.insert(instrument).values({
      symbol: "AMZN",
      name: "Amazon",
      exchange: "NASDAQ",
      currency: "USD",
      assetType: "stock",
    });
    const rows = [tx({ symbol: "AMZN", quantity: "4", price: "180", tradeDate: "2026-06-01" })];
    await executeImport(
      tdb.db,
      portfolioId,
      "snowball",
      await planImport(tdb.db, portfolioId, rows),
      {
        restoreDeleted: false,
      },
    );
    await tdb.db.delete(transaction).where(eq(transaction.instrumentSymbol, "AMZN"));

    const stalePlan = await planImport(tdb.db, portfolioId, rows);
    expect(stalePlan.map((r) => r.disposition)).toEqual(["tombstoned"]);

    const first = await executeImport(tdb.db, portfolioId, "snowball", stalePlan, {
      restoreDeleted: true,
    });
    expect(first.restored).toBe(1);

    // Same stale plan again: the ledger row is already re-linked, so the
    // conditional UPDATE matches nothing and the duplicate insert is undone.
    const second = await executeImport(tdb.db, portfolioId, "snowball", stalePlan, {
      restoreDeleted: true,
    });
    expect(second.restored).toBe(0);
    expect(second.alreadyImported).toBe(1);
    expect(
      await tdb.db.select().from(transaction).where(eq(transaction.instrumentSymbol, "AMZN")),
    ).toHaveLength(1);
  });

  /**
   * The custom-income engine mints a savings account's interest on its pay
   * date. If the broker export arrives AFTER that, its row for the same payment
   * used to land beside the generated one — the credit counted twice. The
   * quantities never match exactly (the engine keeps full precision, a broker
   * rounds to 8dp), so content-matching could not catch it. Broker values win,
   * as they do for auto-added dividends, and the income ledger keeps its link,
   * so the engine never mints that pay date again.
   */
  it("adopts a generated custom-income credit instead of duplicating it", async () => {
    await tdb.db.insert(instrument).values({
      symbol: "SAVINGS_ACC",
      name: "Savings",
      exchange: "CUSTOM",
      currency: "DKK",
      assetType: "custom",
    });
    const [generated] = await tdb.db
      .insert(transaction)
      .values({
        portfolioId,
        instrumentSymbol: "SAVINGS_ACC",
        type: "buy",
        quantity: "193.8782599685499812328767123287672",
        price: "0",
        currency: "DKK",
        tradeDate: "2026-07-30",
        source: "custom-income",
      })
      .returning({ id: transaction.id });
    await tdb.db
      .insert(customIncome)
      .values({
        portfolioId,
        symbol: "SAVINGS_ACC",
        payDate: "2026-07-30",
        transactionId: generated!.id,
      });

    const brokerRow = tx({
      symbol: "SAVINGS_ACC",
      type: "buy",
      quantity: "193.87825997",
      price: "0",
      currency: "DKK",
      tradeDate: "2026-07-30",
      exchange: "CUSTOM_HOLDING",
    });
    const plan = await planImport(tdb.db, portfolioId, [brokerRow]);
    expect(plan.map((r) => r.disposition)).toEqual(["adopt-custom-income"]);

    const result = await executeImport(tdb.db, portfolioId, "snowball", plan, {
      restoreDeleted: false,
    });
    expect(result.adopted).toBe(1);
    expect(result.inserted).toBe(0);

    const rows = await tdb.db
      .select()
      .from(transaction)
      .where(eq(transaction.instrumentSymbol, "SAVINGS_ACC"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe("193.87825997");
    expect(rows[0]!.source).toBeNull();
    const [ledger] = await tdb.db
      .select()
      .from(customIncome)
      .where(eq(customIncome.symbol, "SAVINGS_ACC"));
    expect(ledger!.transactionId).toBe(generated!.id);

    // And a re-import of the same file is a no-op.
    const again = await planImport(tdb.db, portfolioId, [brokerRow]);
    expect(again.map((r) => r.disposition)).toEqual(["already-imported"]);
  });
});
