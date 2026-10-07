import { it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { describeDb, withTestDb, type TestDb } from "../testing";
import {
  customHolding,
  customIncome,
  importRow,
  instrument,
  portfolio,
  transaction,
  user,
} from "../db/schema";
import { convertAllReinvestCredits } from "./reinvest-credits";

describeDb("convertAllReinvestCredits", () => {
  let t: TestDb;
  let portfolioId: string;
  let creditId: string;
  let unpricedId: string;

  beforeAll(async () => {
    t = await withTestDb();
    await t.db.insert(user).values({
      id: "u1",
      name: "U",
      email: "u@x.dk",
      emailVerified: true,
      dividendTaxRate: "35",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId: "u1", name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;
    for (const symbol of ["SAVE_DKK", "NOPRICE"]) {
      await t.db.insert(instrument).values({
        symbol,
        name: symbol,
        exchange: "CUSTOM",
        currency: "DKK",
        assetType: "custom",
      });
      await t.db.insert(customHolding).values({
        symbol,
        portfolioId,
        holdingType: "savings",
        incomeEnabled: true,
        incomeYearlyPct: "3",
        frequencyUnit: "quarter",
        frequencyInterval: 1,
        firstPaymentDate: "2025-03-31",
        autoAdd: true,
        reinvest: true,
      });
    }
    // SAVE_DKK: a deposit at 1.00, then a payment credited the old way — units
    // at a price of zero, the tax withheld as the fee.
    const [, credit] = await t.db
      .insert(transaction)
      .values([
        {
          portfolioId,
          instrumentSymbol: "SAVE_DKK",
          type: "buy",
          quantity: "5000",
          price: "1",
          currency: "DKK",
          tradeDate: "2025-01-02",
        },
        {
          portfolioId,
          instrumentSymbol: "SAVE_DKK",
          type: "buy",
          quantity: "26",
          price: "0",
          currency: "DKK",
          fee: "14",
          feeCurrency: "DKK",
          tradeDate: "2025-03-31",
        },
      ])
      .returning({ id: transaction.id });
    creditId = credit!.id;
    await t.db.insert(customIncome).values({
      portfolioId,
      symbol: "SAVE_DKK",
      payDate: "2025-03-31",
      transactionId: creditId,
    });
    await t.db.insert(importRow).values({
      portfolioId,
      source: "snowball",
      rowHash: "legacy-credit-hash",
      transactionId: creditId,
    });
    // NOPRICE: a credit with no price anywhere to value it at.
    const [unpriced] = await t.db
      .insert(transaction)
      .values({
        portfolioId,
        instrumentSymbol: "NOPRICE",
        type: "buy",
        quantity: "10",
        price: "0",
        currency: "DKK",
        tradeDate: "2025-03-31",
      })
      .returning({ id: transaction.id });
    unpricedId = unpriced!.id;
  }, 60_000);

  afterAll(async () => {
    await t?.stop();
  });

  it("turns a zero-price credit into the payment and the buy it paid for", async () => {
    expect(await convertAllReinvestCredits(t.db)).toBe(1);

    const rows = await t.db
      .select()
      .from(transaction)
      .where(eq(transaction.instrumentSymbol, "SAVE_DKK"));
    const payment = rows.find((r) => r.type === "dividend");
    // 26 units at 1.00 plus 14 withheld is a gross of 40.
    expect(payment).toMatchObject({ quantity: "1", price: "40", fee: "14", feeCurrency: "DKK" });
    expect(payment!.tradeDate).toBe("2025-03-31");
    const credit = rows.find((r) => r.id === creditId);
    expect(credit).toMatchObject({ type: "buy", quantity: "26", price: "1", fee: null });

    const [ledger] = await t.db.select().from(customIncome);
    expect(ledger!.transactionId).toBe(payment!.id);
    expect(ledger!.reinvestTransactionId).toBe(creditId);

    // The import ledger still names the buy, so the old export is recognised.
    const [imported] = await t.db.select().from(importRow);
    expect(imported!.transactionId).toBe(creditId);
  });

  it("leaves a credit it has no price for, and converts nothing twice", async () => {
    expect(await convertAllReinvestCredits(t.db)).toBe(0);
    const [unpriced] = await t.db.select().from(transaction).where(eq(transaction.id, unpricedId));
    expect(unpriced!.price).toBe("0");
    const payments = await t.db.select().from(transaction).where(eq(transaction.type, "dividend"));
    expect(payments).toHaveLength(1);
  });
});
