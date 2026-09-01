import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { instrument, transaction, portfolio, user } from "../db/schema";
import { buildDividendIncomeView } from "./dividend-income-view";

/**
 * What the analytics headline is denominated in when the user has not picked a
 * display currency ("Native").
 *
 * The last resort used to be the literal "USD", so a fresh install with no
 * dividend history read `ANNUAL INCOME $0` — a currency the owner never chose,
 * on a number that did not exist. A European's first look was a dollar sign.
 */
const NOW = new Date("2026-07-18T12:00:00Z");

describeDb("buildDividendIncomeView — no display currency, single-currency book", () => {
  let t: TestDb;
  const userId = "u-native-eur";

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    t = await withTestDb();
    // displayCurrency omitted: this is "Native", the default after sign-up.
    await t.db.insert(user).values({
      id: userId,
      name: "N",
      email: "native@x.dk",
      emailVerified: true,
    });
    await t.db.insert(portfolio).values({ userId, name: "Main" });
    const [pf] = await t.db.select({ id: portfolio.id }).from(portfolio);
    await t.db.insert(instrument).values({
      symbol: "EURCO",
      name: "Euro Holding Co",
      exchange: "XETRA",
      currency: "EUR",
      assetType: "stock",
    });
    // A holding, but no dividend history at all — the state right after a
    // first import, before anything has been fetched.
    await t.db.insert(transaction).values({
      portfolioId: pf!.id,
      instrumentSymbol: "EURCO",
      type: "buy",
      quantity: "10",
      price: "50",
      currency: "EUR",
      tradeDate: "2026-07-01",
    });
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  it("denominates the totals in the book's own currency, not dollars", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {});

    expect(view.summary.projectedTwelveMonthIncome[0]?.currency).toBe("EUR");
    expect(view.summary.trailingTwelveMonthIncome[0]?.currency).toBe("EUR");
    // The value is genuinely zero; only the unit was ever wrong.
    expect(view.summary.projectedTwelveMonthIncome[0]?.amount).toBe("0");
  });
});

describeDb("buildDividendIncomeView — no display currency, mixed-currency book", () => {
  let t: TestDb;
  const userId = "u-native-mixed";

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "M",
      email: "mixed@x.dk",
      emailVerified: true,
    });
    await t.db.insert(portfolio).values({ userId, name: "Main" });
    const [pf] = await t.db.select({ id: portfolio.id }).from(portfolio);
    await t.db.insert(instrument).values([
      {
        symbol: "EURCO",
        name: "Euro Holding Co",
        exchange: "XETRA",
        currency: "EUR",
        assetType: "stock",
      },
      {
        symbol: "USDCO",
        name: "Dollar Holding Co",
        exchange: "NASDAQ",
        currency: "USD",
        assetType: "stock",
      },
    ]);
    await t.db.insert(transaction).values([
      {
        portfolioId: pf!.id,
        instrumentSymbol: "EURCO",
        type: "buy",
        quantity: "10",
        price: "50",
        currency: "EUR",
        tradeDate: "2026-07-01",
      },
      {
        portfolioId: pf!.id,
        instrumentSymbol: "USDCO",
        type: "buy",
        quantity: "10",
        price: "50",
        currency: "USD",
        tradeDate: "2026-07-01",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  it("states no total rather than inventing a currency to state it in", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {});

    // Clients render an absent figure as "—". A zero labelled in a currency
    // nobody chose is not a smaller truth than "we don't know" — it is a
    // different claim, and the wrong one.
    expect(view.summary.projectedTwelveMonthIncome).toEqual([]);
    expect(view.summary.trailingTwelveMonthIncome).toEqual([]);
    expect(view.summary.monthlyBreakdown).toEqual([]);
    expect(view.summary.receivedByYear).toEqual([]);
    expect(view.perHolding).toEqual([]);
    expect(view.incomeByGroup).toEqual({ holdings: [], sector: [], currency: [] });
  });
});
