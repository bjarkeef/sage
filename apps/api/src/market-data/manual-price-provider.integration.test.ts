import { it, expect, beforeAll, afterAll } from "vitest";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { instrument, transaction, manualPrice, portfolio, user } from "../db/schema";
import { ManualPriceProvider, resolvePricePoints } from "./manual-price-provider";

describeDb("ManualPriceProvider", () => {
  let t: TestDb;
  let portfolioId: string;

  beforeAll(async () => {
    t = await withTestDb();
    await t.db.insert(user).values({ id: "u1", name: "U", email: "u@x.dk", emailVerified: true });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId: "u1", name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;
    await t.db.insert(instrument).values([
      {
        symbol: "CASH_DKK",
        name: "Cash account",
        exchange: "CUSTOM",
        currency: "DKK",
        assetType: "custom",
      },
      {
        symbol: "PENSION",
        name: "Pension",
        exchange: "CUSTOM",
        currency: "DKK",
        assetType: "custom",
      },
    ]);
    // CASH_DKK: no marks — price resolves from transaction prices (1.00).
    await t.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "CASH_DKK",
        type: "buy",
        quantity: "10000",
        price: "1",
        currency: "DKK",
        tradeDate: "2026-03-06",
      },
      // reinvest credit: zero price, must NOT become a price point
      {
        portfolioId,
        instrumentSymbol: "CASH_DKK",
        type: "buy",
        quantity: "86.75505479",
        price: "0",
        currency: "DKK",
        tradeDate: "2026-04-30",
      },
    ]);
    // PENSION: marks over time.
    await t.db.insert(manualPrice).values([
      { symbol: "PENSION", date: "2023-03-02", price: "99.31", currency: "DKK" },
      { symbol: "PENSION", date: "2023-06-09", price: "104.49", currency: "DKK" },
    ]);
  });

  afterAll(async () => {
    await t.stop();
  });

  it("resolvePricePoints: marks win, zero-price transactions excluded, ascending", async () => {
    const bank = await resolvePricePoints(t.db, "CASH_DKK");
    expect(bank.map((p) => p.date)).toEqual(["2026-03-06"]);
    expect(bank[0]!.price.toFixed()).toBe("1");

    const pension = await resolvePricePoints(t.db, "PENSION");
    expect(pension.map((p) => p.date)).toEqual(["2023-03-02", "2023-06-09"]);
  });

  it("getQuote returns the latest point; previousClose equals prior point", async () => {
    const p = new ManualPriceProvider(t.db);
    const q = await p.getQuote("PENSION");
    expect(q.price.toDecimal().toFixed()).toBe("104.49");
    expect(q.previousClose!.toDecimal().toFixed()).toBe("99.31");
  });

  it("getQuote for a single-point symbol has flat previousClose (0.00 daily change)", async () => {
    const p = new ManualPriceProvider(t.db);
    const q = await p.getQuote("CASH_DKK");
    expect(q.price.toDecimal().toFixed()).toBe("1");
    expect(q.previousClose!.toDecimal().toFixed()).toBe("1");
  });

  it("getHistoricalPrices emits a seed bar at window start when a price predates it", async () => {
    const p = new ManualPriceProvider(t.db);
    const bars = await p.getHistoricalPrices(
      "PENSION",
      new Date("2023-05-01T00:00:00Z"),
      new Date("2023-07-01T00:00:00Z"),
    );
    // seed bar at 2023-05-01 carrying the 99.31 mark, then the real 104.49 mark
    expect(bars.map((b) => b.date.toISOString().slice(0, 10))).toEqual([
      "2023-05-01",
      "2023-06-09",
    ]);
    expect(bars[0]!.close.toDecimal().toFixed()).toBe("99.31");
    expect(bars[1]!.close.toDecimal().toFixed()).toBe("104.49");
  });

  it("window with zero in-window points still yields the seed bar", async () => {
    const p = new ManualPriceProvider(t.db);
    const bars = await p.getHistoricalPrices(
      "PENSION",
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-02-01T00:00:00Z"),
    );
    expect(bars.map((b) => b.date.toISOString().slice(0, 10))).toEqual(["2024-01-01"]);
    expect(bars[0]!.close.toDecimal().toFixed()).toBe("104.49");
  });

  it("a point exactly on the window start is not duplicated by the seed", async () => {
    const p = new ManualPriceProvider(t.db);
    const bars = await p.getHistoricalPrices(
      "PENSION",
      new Date("2023-06-09T00:00:00Z"),
      new Date("2023-07-01T00:00:00Z"),
    );
    expect(bars.map((b) => b.date.toISOString().slice(0, 10))).toEqual(["2023-06-09"]);
    expect(bars[0]!.close.toDecimal().toFixed()).toBe("104.49");
  });

  it("getDividendHistory is empty; searchSymbol matches custom instruments", async () => {
    const p = new ManualPriceProvider(t.db);
    expect(await p.getDividendHistory("PENSION")).toEqual([]);
    const results = await p.searchSymbol("cash");
    expect(results.map((r) => r.symbol)).toEqual(["CASH_DKK"]);
    expect(results[0]!.assetType).toBe("other"); // AssetType has no "custom"; map to "other"
  });
});
