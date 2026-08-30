import { it, expect, beforeAll, afterAll } from "vitest";
import { Money } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type {
  INewsProvider,
  IAnalystRatingsProvider,
  NewsArticle,
  AnalystRatings,
  Quote,
} from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { instrument } from "../db/schema";

/** A network-free INewsProvider + IAnalystRatingsProvider double, keyed by
 *  symbol. Symbols absent from the config simulate "no coverage" (empty news,
 *  null ratings) rather than erroring — matching real provider behavior. */
class FakeIntelProvider implements INewsProvider, IAnalystRatingsProvider {
  constructor(
    private readonly news: Record<string, NewsArticle[]> = {},
    private readonly ratings: Record<string, AnalystRatings | null> = {},
  ) {}

  getNews(symbol: string): Promise<NewsArticle[]> {
    return Promise.resolve(this.news[symbol] ?? []);
  }

  getAnalystRatings(symbol: string): Promise<AnalystRatings | null> {
    return Promise.resolve(this.ratings[symbol] ?? null);
  }
}

async function post(app: ReturnType<typeof createApp>, body: unknown, cookie: string) {
  const res = await app.request("/transactions", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  if (res.status !== 201)
    throw new Error(`transaction post failed: ${res.status} ${await res.text()}`);
  return res;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

const AAPL_ARTICLE: NewsArticle = {
  title: "Apple posts strong earnings",
  publisher: "Reuters",
  url: "https://example.com/aapl-earnings",
  publishedAt: hoursAgo(2),
  thumbnailUrl: null,
  relatedSymbols: ["AAPL"],
};

const O_ARTICLE: NewsArticle = {
  title: "Realty Income raises its payout",
  publisher: "Bloomberg",
  url: "https://example.com/o-payout",
  // Deliberately newer than AAPL_ARTICLE: pure-recency ordering would put O
  // first, so AAPL still landing first below proves weight is actually
  // driving the ranking, not just the merge's insertion order.
  publishedAt: hoursAgo(1),
  thumbnailUrl: null,
  relatedSymbols: ["O"],
};

const AAPL_RATINGS: AnalystRatings = {
  consensusKey: "buy",
  distribution: { strongBuy: 10, buy: 5, hold: 2, sell: 0, strongSell: 0 },
  targets: {
    low: Money.of("150", "USD"),
    mean: Money.of("200", "USD"),
    high: Money.of("250", "USD"),
    median: Money.of("200", "USD"),
  },
  currentPrice: Money.of("190", "USD"),
  analystCount: 17,
  asOf: new Date("2026-07-21T00:00:00.000Z"),
  upgradeHistory: [
    {
      firm: "BigBank",
      fromGrade: "Hold",
      toGrade: "Buy",
      action: "up",
      date: new Date("2026-07-15T00:00:00.000Z"),
    },
  ],
};

function expectedArticle(a: NewsArticle) {
  return {
    title: a.title,
    publisher: a.publisher,
    url: a.url,
    publishedAt: a.publishedAt.toISOString(),
    thumbnailUrl: a.thumbnailUrl,
    relatedSymbols: a.relatedSymbols,
  };
}

describeDb("intel routes (news + analyst ratings)", () => {
  let tdb: TestDb;
  let cookie: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    tdb = await withTestDb();

    const quote = (symbol: string, price: string): Quote => ({
      symbol,
      price: Money.of(price, "USD"),
      asOf: new Date(),
      previousClose: Money.of(price, "USD"),
    });
    // AAPL 10 × $200 = $2,000 (80%); O 10 × $50 = $500 (20%).
    const marketProvider = new FakeMarketDataProvider({
      quotes: { AAPL: quote("AAPL", "200"), O: quote("O", "50") },
    });
    const intelProvider = new FakeIntelProvider(
      { AAPL: [AAPL_ARTICLE], O: [O_ARTICLE] },
      { AAPL: AAPL_RATINGS }, // MSFT deliberately absent -> uncovered
    );
    const auth = createAuth(tdb.db, testEnv);
    // intelProvider is threaded through createApp as an additional argument;
    // positional undefineds keep the existing (isinResolver, fxRateService,
    // dividendProviders, options) slots at their defaults.
    app = createApp(
      tdb.db,
      marketProvider,
      auth,
      undefined,
      undefined,
      undefined,
      {},
      intelProvider,
    );
    cookie = await signUpTestUser(app, "intel@example.com");

    // AAPL: a real position (buy), so it shows up in the portfolio news feed.
    await post(
      app,
      {
        instrument: {
          symbol: "AAPL",
          name: "Apple Inc",
          exchange: "XNAS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "150",
        tradeDate: "2025-01-01",
      },
      cookie,
    );

    // O: a second real position (buy), so /news has more than one holding to rank.
    await post(
      app,
      {
        instrument: {
          symbol: "O",
          name: "Realty Income Corp",
          exchange: "XNYS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "10",
        price: "50",
        tradeDate: "2025-01-01",
      },
      cookie,
    );

    // MSFT: instrument row only (no position) so the ratings route can resolve
    // a symbol that exists but has no analyst coverage in the fake provider.
    await tdb.db.insert(instrument).values({
      symbol: "MSFT",
      name: "Microsoft Corp",
      exchange: "XNAS",
      currency: "USD",
      assetType: "stock",
    });
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("GET /asset/:slug/news resolves the symbol from the slug and returns the article array", async () => {
    const res = await app.request("/asset/XNAS-AAPL/news", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([expectedArticle(AAPL_ARTICLE)]);
  });

  it("GET /asset/:slug/ratings returns the ratings object for a covered symbol", async () => {
    const res = await app.request("/asset/XNAS-AAPL/ratings", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      consensusKey: string | null;
      analystCount: number;
      asOf: string;
      targets: { mean: { amount: string; currency: string } | null };
      upgradeHistory: { firm: string; toGrade: string; action: string; date: string }[];
    };
    expect(body.consensusKey).toBe("buy");
    expect(body.analystCount).toBe(17);
    expect(body.asOf).toBe(AAPL_RATINGS.asOf.toISOString());
    expect(body.targets.mean).toEqual(AAPL_RATINGS.targets.mean!.toJSON());
    expect(body.upgradeHistory).toEqual([
      {
        firm: "BigBank",
        fromGrade: "Hold",
        toGrade: "Buy",
        action: "up",
        date: AAPL_RATINGS.upgradeHistory[0]!.date.toISOString(),
      },
    ]);
  });

  it("GET /asset/:slug/ratings returns null for a symbol with no analyst coverage", async () => {
    const res = await app.request("/asset/XNAS-MSFT/ratings", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("GET /asset/XNYS-O/news warms the O cache row", async () => {
    const res = await app.request("/asset/XNYS-O/news", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([expectedArticle(O_ARTICLE)]);
  });

  it("GET /news ranks the feed by holding weight and attributes each article", async () => {
    const res = await app.request("/news", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      url: string;
      holding: { symbol: string; name: string; weightPct: number; dayChangePercent: number | null };
      otherSymbols: string[];
    }[];

    // AAPL is 80% of the book, O is 20% — same age, same single-ticker focus.
    expect(body.map((x) => x.holding.symbol)).toEqual(["AAPL", "O"]);
    expect(body[0]!.url).toBe(AAPL_ARTICLE.url);
    expect(body[0]!.holding.name).toBe("Apple Inc");
    expect(body[0]!.holding.weightPct).toBeCloseTo(80, 1);
    expect(body[0]!.holding.dayChangePercent).toBe(0); // price == previousClose
    expect(body[0]!.otherSymbols).toEqual([]);
  });

  it("requires an authenticated session", async () => {
    const res = await app.request("/news");
    expect(res.status).toBe(401);
  });
});
