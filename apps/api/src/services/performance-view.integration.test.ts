import { it, expect, beforeAll, afterAll } from "vitest";
import type { IMarketDataProvider } from "@sage/provider-interface";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { instrument, transaction, portfolio, user, priceDaily } from "../db/schema";
import { buildPerformanceView } from "./performance-view";

/** `n` days before today as a "YYYY-MM-DD" UTC key. Relative by construction —
 *  a hardcoded window would start failing on its own once it aged out. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Answers nothing, successfully. The book under test is priced entirely from
 *  stored bars, so a provider that invents data would only obscure which rows
 *  the assertions are actually reading. */
const silentProvider = {
  getQuote: () => Promise.resolve(null),
  getHistoricalPrices: () => Promise.resolve([]),
  getDividendHistory: () => Promise.resolve([]),
  searchSymbol: () => Promise.resolve([]),
  getAssetProfile: () => Promise.resolve(null),
} as unknown as IMarketDataProvider;

describeDb("buildPerformanceView — unverified split causes", () => {
  let t: TestDb;
  const userId = "perf-fxgap-user";

  beforeAll(async () => {
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "U",
      email: "perf-fxgap@example.com",
      emailVerified: true,
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    const portfolioId = pf!.id;

    await t.db.insert(instrument).values([
      // Trades in EUR against bars stored in USD: convertible only with a rate.
      { symbol: "RATECO", name: "RATECO", exchange: "TEST", currency: "EUR", assetType: "stock" },
      // Trades on a day with no stored bar at all.
      { symbol: "DARKCO", name: "DARKCO", exchange: "TEST", currency: "USD", assetType: "stock" },
    ]);

    // A bar DOES exist on RATECO's trade date — that is the whole point. Its
    // sample is lost to the missing rate below, not to missing history.
    await t.db.insert(priceDaily).values([
      {
        symbol: "RATECO",
        date: daysAgo(30),
        open: "110",
        high: "110",
        low: "110",
        close: "110",
        volume: "0",
        currency: "USD",
      },
    ]);

    const tx = (symbol: string, type: string, date: string, price: string, currency: string) => ({
      portfolioId,
      instrumentSymbol: symbol,
      type,
      quantity: "10",
      price,
      currency,
      tradeDate: date,
    });

    await t.db
      .insert(transaction)
      .values([
        tx("RATECO", "buy", daysAgo(30), "100", "EUR"),
        tx("RATECO", "split", daysAgo(10), "0", "EUR"),
        tx("DARKCO", "buy", daysAgo(30), "50", "USD"),
        tx("DARKCO", "split", daysAgo(10), "0", "USD"),
      ]);
  }, 90_000);

  afterAll(async () => {
    await t?.stop();
  });

  // Both symbols carry a split nothing could check, so both belong here —
  // the list itself does not distinguish them, which is exactly why the
  // separate cause below has to be published alongside it.
  it("reports both unverifiable splits", async () => {
    const view = await buildPerformanceView({ db: t.db, provider: silentProvider }, userId, {
      range: "ALL",
    });
    expect(view.unverifiedSplits).toContain("RATECO");
    expect(view.unverifiedSplits).toContain("DARKCO");
  });

  // The defect this test was written for: `findBasisMismatches` computes the
  // distinction and /corporate-actions renders it, but this view discarded it,
  // leaving /performance's banner to assert one cause for both.
  it("publishes which unverified splits are FX gaps rather than missing history", async () => {
    const view = await buildPerformanceView({ db: t.db, provider: silentProvider }, userId, {
      range: "ALL",
    });
    expect(view.fxGapSymbols).toContain("RATECO");
    expect(view.fxGapSymbols).not.toContain("DARKCO");
  });
});
