import { it, expect, beforeAll, afterAll } from "vitest";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { instrument, transaction, portfolio, user, priceDaily } from "../db/schema";
import { loadCorporateActions } from "./corporate-actions-view";

/** `n` days before today as a "YYYY-MM-DD" UTC key. Relative by construction —
 *  a hardcoded window would start failing on its own once it aged out. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describeDb("loadCorporateActions", () => {
  let t: TestDb;

  const adjustedUser = "ca-adjusted-user";
  const unverifiedUser = "ca-unverified-user";
  const noSplitUser = "ca-no-split-user";
  const portfolioOf = new Map<string, string>();

  beforeAll(async () => {
    t = await withTestDb();

    await t.db.insert(user).values([
      { id: adjustedUser, name: "A", email: "ca-adjusted@example.com", emailVerified: true },
      { id: unverifiedUser, name: "U", email: "ca-unverified@example.com", emailVerified: true },
      { id: noSplitUser, name: "N", email: "ca-nosplit@example.com", emailVerified: true },
    ]);

    for (const userId of [adjustedUser, unverifiedUser, noSplitUser]) {
      const [pf] = await t.db
        .insert(portfolio)
        .values({ userId, name: "Main" })
        .returning({ id: portfolio.id });
      portfolioOf.set(userId, pf!.id);
    }

    await t.db.insert(instrument).values([
      {
        symbol: "ACME",
        name: "Acme Reverse Split Co",
        exchange: "TEST",
        currency: "USD",
        assetType: "stock",
      },
      {
        symbol: "THAMES.L",
        name: "Thames Forward Split Co",
        exchange: "TEST",
        currency: "USD",
        assetType: "stock",
      },
      {
        symbol: "STEADY",
        name: "Steady Co",
        exchange: "TEST",
        currency: "USD",
        assetType: "stock",
      },
    ]);

    // ACME: a reverse split whose stored history is back-adjusted — exactly
    // the shape that motivated this page. Every stored bar reads ~10x what
    // was actually paid, and the recorded 10-for-1 split explains that ratio
    // within tolerance, so the verdict is "adjusted".
    await t.db.insert(priceDaily).values([
      {
        symbol: "ACME",
        date: daysAgo(30),
        open: "50",
        high: "50",
        low: "50",
        close: "50",
        volume: "0",
        currency: "USD",
      },
      {
        symbol: "ACME",
        date: daysAgo(20),
        open: "50",
        high: "50",
        low: "50",
        close: "50",
        volume: "0",
        currency: "USD",
      },
    ]);
    await t.db.insert(transaction).values([
      {
        portfolioId: portfolioOf.get(adjustedUser)!,
        instrumentSymbol: "ACME",
        type: "buy",
        quantity: "10",
        price: "5",
        currency: "USD",
        tradeDate: daysAgo(30),
      },
      {
        portfolioId: portfolioOf.get(adjustedUser)!,
        instrumentSymbol: "ACME",
        type: "sell",
        quantity: "5",
        price: "5",
        currency: "USD",
        tradeDate: daysAgo(20),
      },
      {
        portfolioId: portfolioOf.get(adjustedUser)!,
        instrumentSymbol: "ACME",
        type: "split",
        quantity: "0.1",
        price: "0",
        currency: "USD",
        tradeDate: daysAgo(10),
      },
    ]);

    // THAMES.L: a recorded forward split with no stored bar anywhere near its
    // trade — no price_daily row for it exists at all, so `pricesFrom` has
    // nothing to report and the verdict cannot be more than "unverified".
    await t.db.insert(transaction).values([
      {
        portfolioId: portfolioOf.get(unverifiedUser)!,
        instrumentSymbol: "THAMES.L",
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "USD",
        tradeDate: daysAgo(30),
      },
      {
        portfolioId: portfolioOf.get(unverifiedUser)!,
        instrumentSymbol: "THAMES.L",
        type: "split",
        quantity: "2",
        price: "0",
        currency: "USD",
        tradeDate: daysAgo(10),
      },
    ]);

    // STEADY: an ordinary holding with no corporate action in its ledger.
    await t.db.insert(priceDaily).values([
      {
        symbol: "STEADY",
        date: daysAgo(30),
        open: "100",
        high: "100",
        low: "100",
        close: "100",
        volume: "0",
        currency: "USD",
      },
    ]);
    await t.db.insert(transaction).values([
      {
        portfolioId: portfolioOf.get(noSplitUser)!,
        instrumentSymbol: "STEADY",
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "USD",
        tradeDate: daysAgo(30),
      },
    ]);
  }, 90_000);

  afterAll(async () => {
    await t?.stop();
  });

  it("resolves a split explained by the recorded ratio as adjusted, with stored bars behind it", async () => {
    const view = await loadCorporateActions({ db: t.db }, adjustedUser);
    expect(view.actions).toHaveLength(1);
    expect(view.actions[0]).toMatchObject({
      symbol: "ACME",
      verdict: "adjusted",
      ratio: "10 → 1",
      pricesFrom: daysAgo(30),
      fxGap: false,
    });
    // Both trades priced 10x off their post-split bar: median factor is 10.
    expect(view.actions[0]!.detectedFactor).toBeCloseTo(10, 0);
  });

  it("reports a split with no stored bars as unverified, with no pricesFrom to name", async () => {
    const view = await loadCorporateActions({ db: t.db }, unverifiedUser);
    expect(view.actions).toHaveLength(1);
    expect(view.actions[0]).toMatchObject({
      symbol: "THAMES.L",
      verdict: "unverified",
      ratio: "1 → 2",
      pricesFrom: null,
      // No bar was ever joined for THAMES.L, so this is the "no history"
      // shape, not the "FX rate missing" shape.
      fxGap: false,
    });
  });

  it("returns no actions for a book with no splits at all", async () => {
    const view = await loadCorporateActions({ db: t.db }, noSplitUser);
    expect(view.actions).toEqual([]);
    // The book still has one buy to check against a stored bar, so coverage
    // is not vacuously zero — it just has nothing to list as a split.
    expect(view.coverage).toEqual({ checked: 1, total: 1 });
  });
});
