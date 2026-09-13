import { it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, isNull } from "drizzle-orm";
import { describeDb, withTestDb, type TestDb } from "../testing";
import {
  user,
  portfolio,
  instrument,
  transaction,
  dividendHistory,
  autoDividend,
} from "../db/schema";
import { reconcileDividends } from "./dividend-reconciliation";

describeDb("reconcileDividends", () => {
  let tdb: TestDb;
  let userId: string;
  let portfolioId: string;

  async function allTxs() {
    return tdb.db.select().from(transaction).where(eq(transaction.portfolioId, portfolioId));
  }

  async function forceNextRun() {
    await tdb.db
      .update(portfolio)
      .set({ lastReconciledAt: null })
      .where(eq(portfolio.id, portfolioId));
  }

  beforeAll(async () => {
    tdb = await withTestDb();

    userId = "recon-user";
    await tdb.db.insert(user).values({
      id: userId,
      name: "Recon User",
      email: "recon@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [pf] = await tdb.db
      .insert(portfolio)
      .values({ userId, name: "Default" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    await tdb.db.insert(instrument).values({
      symbol: "KO",
      name: "Coca-Cola",
      exchange: "XNYS",
      currency: "USD",
      assetType: "stock",
    });
    // Held since 2025-01-01; two past dividends, one in-flight (payment ahead).
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "KO",
      type: "buy",
      quantity: "100",
      price: "50",
      currency: "USD",
      tradeDate: "2025-01-01",
    });
    const future = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const pastEx = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "KO",
        exDate: "2025-06-01",
        amountPerShare: "0.46",
        currency: "USD",
        paymentDate: "2025-06-15",
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
        exDate: pastEx,
        amountPerShare: "0.48",
        currency: "USD",
        paymentDate: future,
        paymentDateEstimated: false,
        source: "test",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("backfills missing dividends as source='auto' transactions with ledger rows", async () => {
    await reconcileDividends(tdb.db, userId);

    const txs = await allTxs();
    const autos = txs.filter((t) => t.source === "auto");
    expect(autos).toHaveLength(2); // in-flight dividend excluded
    expect(
      autos
        .map((t) => ({ q: t.quantity, p: t.price, d: t.tradeDate }))
        .sort((a, b) => a.d.localeCompare(b.d)),
    ).toEqual([
      { q: "100", p: "0.46", d: "2025-06-15" },
      { q: "100", p: "0.46", d: "2025-09-15" },
    ]);

    const ledger = await tdb.db
      .select()
      .from(autoDividend)
      .where(eq(autoDividend.portfolioId, portfolioId));
    expect(ledger).toHaveLength(2);
    expect(ledger.every((l) => l.transactionId !== null)).toBe(true);
  });

  it("is idempotent: an immediate second run adds nothing (24h gate)", async () => {
    await reconcileDividends(tdb.db, userId);
    expect((await allTxs()).filter((t) => t.source === "auto")).toHaveLength(2);
  });

  it("stays idempotent via the ledger even when the gate is bypassed", async () => {
    await forceNextRun();
    await reconcileDividends(tdb.db, userId);
    expect((await allTxs()).filter((t) => t.source === "auto")).toHaveLength(2);
  });

  it("never resurrects a deleted auto dividend (tombstone)", async () => {
    const [victim] = (await allTxs()).filter((t) => t.source === "auto");
    await tdb.db.delete(transaction).where(eq(transaction.id, victim!.id));

    // FK went NULL, ledger row survives = tombstone.
    const tombstones = await tdb.db
      .select()
      .from(autoDividend)
      .where(and(eq(autoDividend.portfolioId, portfolioId), isNull(autoDividend.transactionId)));
    expect(tombstones).toHaveLength(1);

    await forceNextRun();
    await reconcileDividends(tdb.db, userId);
    expect((await allTxs()).filter((t) => t.source === "auto")).toHaveLength(1);
  });

  it("does nothing when auto_add_dividends is off", async () => {
    await tdb.db
      .update(portfolio)
      .set({ autoAddDividends: false })
      .where(eq(portfolio.id, portfolioId));
    await forceNextRun();
    await reconcileDividends(tdb.db, userId);
    const [pf] = await tdb.db.select().from(portfolio).where(eq(portfolio.id, portfolioId));
    expect(pf!.lastReconciledAt).toBeNull(); // gate exits before claiming the run
    await tdb.db
      .update(portfolio)
      .set({ autoAddDividends: true })
      .where(eq(portfolio.id, portfolioId));
  });

  it("skips dividends already covered by a manually recorded transaction", async () => {
    // New symbol with one provider dividend and a user-entered dividend tx 2 days off the pay date.
    await tdb.db.insert(instrument).values({
      symbol: "O",
      name: "Realty Income",
      exchange: "XNYS",
      currency: "USD",
      assetType: "stock",
    });
    await tdb.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "O",
        type: "buy",
        quantity: "50",
        price: "60",
        currency: "USD",
        tradeDate: "2025-01-01",
      },
      {
        portfolioId,
        instrumentSymbol: "O",
        type: "dividend",
        quantity: "50",
        price: "0.27",
        currency: "USD",
        tradeDate: "2025-05-17",
      },
    ]);
    await tdb.db.insert(dividendHistory).values({
      symbol: "O",
      exDate: "2025-05-01",
      amountPerShare: "0.27",
      currency: "USD",
      paymentDate: "2025-05-15",
      paymentDateEstimated: false,
      source: "test",
    });

    await forceNextRun();
    await reconcileDividends(tdb.db, userId);
    const oAutos = (await allTxs()).filter(
      (t) => t.instrumentSymbol === "O" && t.source === "auto",
    );
    expect(oAutos).toHaveLength(0);
  });

  it("backfills a dividend held for, but skips one paid out after the position was fully sold", async () => {
    // Fully sold out before the LATER dividend's ex-date, but still held for
    // the EARLIER one — guards the "every symbol ever transacted" query
    // against regressing to currently-held-only (a sold-out symbol must still
    // get its earlier, held-for dividends backfilled).
    await tdb.db.insert(instrument).values({
      symbol: "TRIAD",
      name: "Triad Industrial",
      exchange: "XNYS",
      currency: "USD",
      assetType: "stock",
    });
    await tdb.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "TRIAD",
        type: "buy",
        quantity: "30",
        price: "100",
        currency: "USD",
        tradeDate: "2024-01-02",
      },
      {
        portfolioId,
        instrumentSymbol: "TRIAD",
        type: "sell",
        quantity: "30",
        price: "100",
        currency: "USD",
        tradeDate: "2024-04-01",
      },
    ]);
    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "TRIAD",
        exDate: "2024-03-01",
        amountPerShare: "1.50",
        currency: "USD",
        paymentDate: "2024-03-15",
        paymentDateEstimated: false,
        source: "test",
      },
      {
        symbol: "TRIAD",
        exDate: "2024-05-01",
        amountPerShare: "1.50",
        currency: "USD",
        paymentDate: "2024-05-15",
        paymentDateEstimated: false,
        source: "test",
      },
    ]);

    await forceNextRun();
    await reconcileDividends(tdb.db, userId);
    const mmmAutos = (await allTxs()).filter(
      (t) => t.instrumentSymbol === "TRIAD" && t.source === "auto",
    );
    expect(mmmAutos).toHaveLength(1);
    expect(mmmAutos[0]!.tradeDate).toBe("2024-03-15");
    expect(mmmAutos[0]!.quantity).toBe("30");
  });

  // A dividend row's `fee` is the tax withheld before the cash landed. These
  // rows carried nothing, which states that none was taken — never true of a
  // real payment, and it split the ledger by provenance: imported rows taxed
  // at what the broker actually took, reconciled rows at zero. Reporting
  // income net would then have bent the trend at the point a book stopped
  // importing and started reconciling.
  it("withholds tax at the user's declared rate, and leaves earlier rows alone", async () => {
    // Every auto row so far was created while the rate was unset.
    const before = (await allTxs()).filter((t) => t.source === "auto");
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((t) => t.fee === null && t.feeCurrency === null)).toBe(true);

    await tdb.db.update(user).set({ dividendTaxRate: "15.00" }).where(eq(user.id, userId));
    await tdb.db.insert(instrument).values({
      symbol: "WITHHOLD",
      name: "Withholding Test Co",
      exchange: "XNYS",
      currency: "USD",
      assetType: "stock",
    });
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "WITHHOLD",
      type: "buy",
      quantity: "40",
      price: "10",
      currency: "USD",
      tradeDate: "2024-01-02",
    });
    await tdb.db.insert(dividendHistory).values({
      symbol: "WITHHOLD",
      exDate: "2024-04-01",
      amountPerShare: "0.25",
      currency: "USD",
      paymentDate: "2024-04-15",
      paymentDateEstimated: false,
      source: "test",
    });

    await forceNextRun();
    await reconcileDividends(tdb.db, userId);

    const [row] = (await allTxs()).filter(
      (t) => t.instrumentSymbol === "WITHHOLD" && t.source === "auto",
    );
    expect(row).toBeDefined();
    // 40 shares x 0.25 = 10.00 gross; 15% of that is 1.50.
    expect(Number(row!.fee)).toBeCloseTo(1.5, 10);
    expect(row!.feeCurrency).toBe("USD");

    // The rows that predate the rate are not retrofitted here — that is the
    // migration's job, and doing it twice would tax them again.
    const after = (await allTxs()).filter(
      (t) => t.source === "auto" && t.instrumentSymbol !== "WITHHOLD",
    );
    expect(after.every((t) => t.fee === null)).toBe(true);
  });
});
