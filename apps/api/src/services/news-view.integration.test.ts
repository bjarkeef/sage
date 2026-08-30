import { it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type {
  AssetProfile,
  Dividend,
  IMarketDataProvider,
  INewsProvider,
  NewsArticle,
  PriceBar,
  Quote,
  SearchResult,
} from "@sage/provider-interface";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { user, portfolio, instrument, transaction, newsCache } from "../db/schema";
import { getSymbolNews, getPortfolioNews } from "./news-view";

/** Fake INewsProvider that counts calls per symbol so tests can assert the
 *  cache short-circuits repeat fetches. */
class FakeNewsProvider implements INewsProvider {
  calls: Record<string, number> = {};

  constructor(private articlesBySymbol: Record<string, NewsArticle[]>) {}

  getNews(symbol: string): Promise<NewsArticle[]> {
    this.calls[symbol] = (this.calls[symbol] ?? 0) + 1;
    return Promise.resolve(this.articlesBySymbol[symbol] ?? []);
  }
}

/** Wraps a FakeMarketDataProvider and counts calls per method, mirroring
 *  FakeNewsProvider's `calls` counter above. Used to prove the cold-cache
 *  path in getPortfolioNews never reaches for quotes/FX at all — not just
 *  that it returns the right value. */
class CountingMarketDataProvider implements IMarketDataProvider {
  calls: Record<string, number> = {};

  constructor(private readonly inner: FakeMarketDataProvider) {}

  private count(method: string): void {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
  }

  getQuote(symbol: string): Promise<Quote> {
    this.count("getQuote");
    return this.inner.getQuote(symbol);
  }

  getHistoricalPrices(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
    this.count("getHistoricalPrices");
    return this.inner.getHistoricalPrices(symbol, from, to);
  }

  getDividendHistory(symbol: string): Promise<Dividend[]> {
    this.count("getDividendHistory");
    return this.inner.getDividendHistory(symbol);
  }

  searchSymbol(query: string): Promise<SearchResult[]> {
    this.count("searchSymbol");
    return this.inner.searchSymbol(query);
  }

  getAssetProfile(symbol: string): Promise<AssetProfile> {
    this.count("getAssetProfile");
    return this.inner.getAssetProfile(symbol);
  }
}

function article(url: string, iso: string, symbols: string[]): NewsArticle {
  return {
    title: url,
    publisher: "Fake Wire",
    url,
    publishedAt: new Date(iso),
    thumbnailUrl: null,
    relatedSymbols: symbols,
  };
}

// getPortfolioNews now routes through rankPortfolioNews's 14-day cutoff, so
// fixtures consumed by that path must stay relative to "now" — an absolute
// date silently ages out once the wall clock passes it. hoursAgo mirrors
// intel.integration.test.ts's fixture pattern.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describeDb("news-view", () => {
  let tdb: TestDb;
  let userId: string;
  let portfolioId: string;

  beforeAll(async () => {
    tdb = await withTestDb();

    userId = "news-user";
    await tdb.db.insert(user).values({
      id: userId,
      name: "News User",
      email: "news@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [pf] = await tdb.db
      .insert(portfolio)
      .values({ userId, name: "Default" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    await tdb.db.insert(instrument).values([
      { symbol: "KO", name: "Coca-Cola", exchange: "XNYS", currency: "USD", assetType: "stock" },
      { symbol: "O", name: "Realty Income", exchange: "XNYS", currency: "USD", assetType: "stock" },
    ]);
    await tdb.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "KO",
        type: "buy",
        quantity: "10",
        price: "50",
        currency: "USD",
        tradeDate: "2025-01-01",
      },
      {
        portfolioId,
        instrumentSymbol: "O",
        type: "buy",
        quantity: "20",
        price: "60",
        currency: "USD",
        tradeDate: "2025-01-01",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("getSymbolNews cold-fetches from the provider, stores a cache row, and returns it", async () => {
    const provider = new FakeNewsProvider({
      KO: [article("ko-1", hoursAgo(48), ["KO"])],
    });

    const out = await getSymbolNews(tdb.db, provider, "KO");

    expect(out.map((a) => a.url)).toEqual(["ko-1"]);
    expect(provider.calls.KO).toBe(1);

    const [row] = await tdb.db.select().from(newsCache).where(eq(newsCache.symbol, "KO"));
    expect(row).toBeTruthy();
    expect(row!.articles.map((a) => a.url)).toEqual(["ko-1"]);
  });

  it("serves the cached row on a second call without calling the provider again", async () => {
    const provider = new FakeNewsProvider({
      KO: [article("ko-should-not-be-fetched", "2026-07-22T00:00:00Z", ["KO"])],
    });

    const out = await getSymbolNews(tdb.db, provider, "KO");

    expect(out.map((a) => a.url)).toEqual(["ko-1"]); // still the row stored by the cold fetch
    expect(provider.calls.KO).toBeUndefined(); // never called on this provider instance
  });

  it("getPortfolioNews merges and dedupes cached news across held symbols", async () => {
    const provider = new FakeNewsProvider({});

    // O has no cached row yet; seed it directly so the read path is exercised
    // without depending on trigger timing for the assertion.
    await tdb.db.insert(newsCache).values({
      symbol: "O",
      articles: [
        {
          title: "o-1",
          publisher: "P",
          url: "o-1",
          publishedAt: hoursAgo(24),
          thumbnailUrl: null,
          relatedSymbols: ["O"],
        },
      ],
      fetchedAt: new Date(),
    });

    // No quotes configured: buildPortfolioView leaves both positions unpriced
    // (weight 0), which is fine here — this test only exercises the merge/dedupe
    // read path, not relevance ordering.
    const marketProvider = new FakeMarketDataProvider();
    const out = await getPortfolioNews({ db: tdb.db, provider: marketProvider }, provider, userId);

    expect(out.map((a) => a.url).sort()).toEqual(["ko-1", "o-1"]);
  });

  it("returns [] on a cold cache without ever calling the quote provider", async () => {
    // A distinct user/portfolio/symbol so no news_cache row exists anywhere
    // for it — KO and O above already got cache rows from earlier tests in
    // this file, so reusing them wouldn't exercise the cold path.
    const coldUserId = "news-cold-user";
    await tdb.db.insert(user).values({
      id: coldUserId,
      name: "Cold User",
      email: "news-cold@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [pf] = await tdb.db
      .insert(portfolio)
      .values({ userId: coldUserId, name: "Default" })
      .returning({ id: portfolio.id });
    const coldPortfolioId = pf!.id;

    await tdb.db.insert(instrument).values({
      symbol: "FIZZCO",
      name: "PepsiCo",
      exchange: "XNYS",
      currency: "USD",
      assetType: "stock",
    });
    await tdb.db.insert(transaction).values({
      portfolioId: coldPortfolioId,
      instrumentSymbol: "FIZZCO",
      type: "buy",
      quantity: "5",
      price: "170",
      currency: "USD",
      tradeDate: "2025-01-01",
    });

    const newsProvider = new FakeNewsProvider({});
    const marketProvider = new CountingMarketDataProvider(new FakeMarketDataProvider());

    const out = await getPortfolioNews(
      { db: tdb.db, provider: marketProvider },
      newsProvider,
      coldUserId,
    );

    expect(out).toEqual([]);
    // The cost guarantee: an empty merged pool must short-circuit before
    // buildPortfolioView ever asks the market-data provider for a quote.
    expect(marketProvider.calls.getQuote).toBeUndefined();
  });
});
