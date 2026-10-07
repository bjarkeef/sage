import { it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { user, portfolio, instrument, transaction, dividendHistory } from "../db/schema";
import { correctDividendCurrencies } from "./dividend-currency-correction";

// EUDIV.DE: an invented EUR-listed fund distributing in USD. The provider sends
// its USD amounts labelled EUR; the broker booked them in USD. RHEIN.DE: an
// invented fund whose provider rows are genuine EUR conversions of a USD
// distribution — the numbers differ by the exchange rate, so it keeps its label.
describeDb("correctDividendCurrencies", () => {
  let tdb: TestDb;
  let portfolioId: string;

  beforeAll(async () => {
    tdb = await withTestDb();
    await tdb.db.insert(user).values({
      id: "fx-user",
      name: "FX User",
      email: "fx@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [pf] = await tdb.db
      .insert(portfolio)
      .values({ userId: "fx-user", name: "Default" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    for (const symbol of ["EUDIV.DE", "RHEIN.DE"]) {
      await tdb.db.insert(instrument).values({
        symbol,
        name: `${symbol} fund`,
        exchange: "XETR",
        currency: "EUR",
        assetType: "etf",
      });
      await tdb.db.insert(transaction).values({
        portfolioId,
        instrumentSymbol: symbol,
        type: "buy",
        quantity: "100",
        price: "10",
        currency: "EUR",
        tradeDate: "2025-01-02",
      });
    }

    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "EUDIV.DE",
        exDate: "2023-02-06",
        paymentDate: "2023-02-27",
        amountPerShare: "0.052471",
        currency: "EUR",
        source: "provider",
      },
      {
        symbol: "EUDIV.DE",
        exDate: "2023-03-06",
        paymentDate: "2023-03-27",
        amountPerShare: "0.052216",
        currency: "EUR",
        source: "provider",
      },
      {
        symbol: "EUDIV.DE",
        exDate: "2023-04-03",
        paymentDate: "2023-04-24",
        amountPerShare: "0.052095",
        currency: "EUR",
        source: "provider",
      },
      {
        symbol: "RHEIN.DE",
        exDate: "2023-06-12",
        paymentDate: "2023-07-03",
        amountPerShare: "0.18000",
        currency: "EUR",
        source: "provider",
      },
      {
        symbol: "RHEIN.DE",
        exDate: "2023-09-11",
        paymentDate: "2023-10-02",
        amountPerShare: "0.24000",
        currency: "EUR",
        source: "provider",
      },
    ]);

    await tdb.db.insert(transaction).values([
      // Broker-booked (imported): the evidence.
      {
        portfolioId,
        instrumentSymbol: "EUDIV.DE",
        type: "dividend",
        quantity: "100",
        price: "0.05247",
        currency: "USD",
        tradeDate: "2023-02-06",
      },
      {
        portfolioId,
        instrumentSymbol: "EUDIV.DE",
        type: "dividend",
        quantity: "100",
        price: "0.05222",
        currency: "USD",
        tradeDate: "2023-03-06",
      },
      {
        portfolioId,
        instrumentSymbol: "RHEIN.DE",
        type: "dividend",
        quantity: "100",
        price: "0.20700",
        currency: "USD",
        tradeDate: "2023-06-12",
      },
      {
        portfolioId,
        instrumentSymbol: "RHEIN.DE",
        type: "dividend",
        quantity: "100",
        price: "0.27600",
        currency: "USD",
        tradeDate: "2023-09-11",
      },
      // Auto-added from the mislabelled provider row: one taxed, one not.
      {
        portfolioId,
        instrumentSymbol: "EUDIV.DE",
        type: "dividend",
        quantity: "100",
        price: "0.052095",
        currency: "EUR",
        fee: "1.40",
        feeCurrency: "EUR",
        tradeDate: "2023-04-24",
        source: "auto",
      },
      {
        portfolioId,
        instrumentSymbol: "EUDIV.DE",
        type: "dividend",
        quantity: "1",
        price: "0.052095",
        currency: "EUR",
        tradeDate: "2023-04-24",
        source: "auto",
      },
    ]);
  });

  afterAll(async () => {
    await tdb?.stop();
  });

  it("relabels a mislabelled provider history and the dividends auto-added from it", async () => {
    await correctDividendCurrencies(tdb.db, ["EUDIV.DE", "RHEIN.DE"]);

    const history = await tdb.db
      .select({ currency: dividendHistory.currency, amount: dividendHistory.amountPerShare })
      .from(dividendHistory)
      .where(eq(dividendHistory.symbol, "EUDIV.DE"));
    expect(history.map((r) => r.currency)).toEqual(["USD", "USD", "USD"]);
    // Only the label moves; the digits were already the fund's USD amounts.
    expect(history.map((r) => r.amount).sort()).toEqual(["0.052095", "0.052216", "0.052471"]);

    const auto = await tdb.db
      .select({
        currency: transaction.currency,
        fee: transaction.fee,
        feeCurrency: transaction.feeCurrency,
      })
      .from(transaction)
      .where(and(eq(transaction.instrumentSymbol, "EUDIV.DE"), eq(transaction.source, "auto")));
    expect(auto).toHaveLength(2);
    expect(auto.every((r) => r.currency === "USD")).toBe(true);
    expect(auto.find((r) => r.fee != null)?.feeCurrency).toBe("USD");
    expect(auto.find((r) => r.fee == null)?.feeCurrency).toBeNull();
  });

  it("keeps a provider's genuine conversions", async () => {
    const history = await tdb.db
      .select({ currency: dividendHistory.currency })
      .from(dividendHistory)
      .where(eq(dividendHistory.symbol, "RHEIN.DE"));
    expect(history.every((r) => r.currency === "EUR")).toBe(true);
  });

  it("is idempotent", async () => {
    await correctDividendCurrencies(tdb.db, ["EUDIV.DE", "RHEIN.DE"]);
    const rows = await tdb.db
      .select({ symbol: dividendHistory.symbol, currency: dividendHistory.currency })
      .from(dividendHistory);
    expect(rows.filter((r) => r.symbol === "EUDIV.DE").every((r) => r.currency === "USD")).toBe(
      true,
    );
    expect(rows.filter((r) => r.symbol === "RHEIN.DE").every((r) => r.currency === "EUR")).toBe(
      true,
    );
  });
});
