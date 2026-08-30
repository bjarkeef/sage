import { it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Money } from "@sage/core";
import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import { ProviderUnavailableError } from "@sage/provider-interface";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { instrument, portfolio, transaction, user } from "../db/schema";
import { PriceStore } from "../market-data/price-store";
import {
  PersistedPriceProvider,
  resetPriceAttemptsForTests,
  drainPriceRefreshesForTests,
} from "../market-data/persisted-price-provider";
import { buildPortfolioView } from "../services/portfolio-view";

const NOW = new Date();

/** Every price call fails, exactly as during the 2026-08-09 Yahoo outage. */
class DeadProvider implements IMarketDataProvider {
  getQuote(): Promise<Quote> {
    return Promise.reject(new ProviderUnavailableError("everything is down"));
  }
  getHistoricalPrices(): Promise<PriceBar[]> {
    return Promise.reject(new ProviderUnavailableError("everything is down"));
  }
  getDividendHistory(): Promise<Dividend[]> {
    return Promise.resolve([]);
  }
  searchSymbol(): Promise<SearchResult[]> {
    return Promise.resolve([]);
  }
  getAssetProfile(): Promise<AssetProfile> {
    return Promise.reject(new ProviderUnavailableError("everything is down"));
  }
}

describeDb("portfolio during a total provider outage", () => {
  let t: TestDb;
  let userId: string;

  beforeAll(async () => {
    t = await withTestDb();
    userId = "outage-user";
    await t.db
      .insert(user)
      .values({ id: userId, name: "O", email: "outage@x.dk", emailVerified: true });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });

    await t.db.insert(instrument).values({
      symbol: "AAPL",
      name: "Apple",
      exchange: "XNAS",
      currency: "USD",
      assetType: "stock",
    });
    await t.db.insert(transaction).values({
      portfolioId: pf!.id,
      instrumentSymbol: "AAPL",
      type: "buy",
      quantity: "10",
      price: "100",
      currency: "USD",
      tradeDate: new Date(NOW.getTime() - 30 * 86_400_000).toISOString().slice(0, 10),
    });

    // A price was successfully stored before the outage began.
    await new PriceStore(t.db).writeQuote(
      {
        symbol: "AAPL",
        price: Money.of("150", "USD"),
        asOf: NOW,
        previousClose: Money.of("148", "USD"),
      },
      new Date(NOW.getTime() - 2 * 86_400_000),
    );
  });

  afterAll(async () => {
    await t.stop();
  });

  // The stored quote above is deliberately 2 days old, well past QUOTE_TTL_MS,
  // so `getQuote` fires a background refresh against the DeadProvider. Drain it
  // before the next test's `beforeEach` resets the throttle state, and reset
  // that state up front so this suite is not sensitive to load order with any
  // other file exercising the same module-level maps.
  beforeEach(() => {
    resetPriceAttemptsForTests();
  });

  afterEach(async () => {
    await drainPriceRefreshesForTests();
  });

  it("still values the portfolio from stored prices", async () => {
    const provider = new PersistedPriceProvider(new PriceStore(t.db), new DeadProvider());

    // `buildPortfolioView` takes its dependencies as an object, not positionally.
    // Positions live under `body` — every other caller destructures `{ body }`.
    const view = await buildPortfolioView({ db: t.db, provider }, userId, {});
    const position = view.body.positions.find((p) => p.symbol === "AAPL");

    // Before price persistence this was null and the UI read "unavailable".
    // `marketValue` on the returned position is a MoneyDTO, not a Money.
    expect(position).toBeDefined();
    expect(position!.marketValue).not.toBeNull();
    expect(position!.marketValue!.amount).toBe("1500");
  });
});
