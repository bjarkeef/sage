import { describe, it, expect } from "vitest";
import {
  mergeAndDedupeNews,
  pickStaleNewsSymbols,
  rankPortfolioNews,
  buildNewsHoldings,
  NEWS_FEED_CAP,
} from "./news-view";
import type { StoredNewsArticle } from "../db/schema";
import type { NewsHolding, MergedNewsArticle } from "./news-view";

const a = (url: string, iso: string): StoredNewsArticle => ({
  title: url,
  publisher: "P",
  url,
  publishedAt: iso,
  thumbnailUrl: null,
  relatedSymbols: [],
});

describe("mergeAndDedupeNews", () => {
  it("dedupes by url, keeps newest, sorts desc, and caps", () => {
    const out = mergeAndDedupeNews(
      [
        {
          symbol: "AAPL",
          articles: [a("u1", "2026-07-01T00:00:00Z"), a("u2", "2026-07-03T00:00:00Z")],
        },
        {
          symbol: "MSFT",
          articles: [a("u1", "2026-07-01T00:00:00Z"), a("u3", "2026-07-02T00:00:00Z")],
        },
      ],
      new Set(["AAPL", "MSFT"]),
      2,
    );
    expect(out.map((x) => x.url)).toEqual(["u2", "u3"]); // u1 deduped, sorted desc, capped to 2
  });

  it("unions the cache-row symbols an article appeared under", () => {
    const [merged] = mergeAndDedupeNews(
      [
        { symbol: "AAPL", articles: [a("u1", "2026-07-01T00:00:00Z")] },
        { symbol: "MSFT", articles: [a("u1", "2026-07-01T00:00:00Z")] },
      ],
      new Set(["AAPL", "MSFT"]),
    );
    expect(merged!.matchedSymbols.sort()).toEqual(["AAPL", "MSFT"]);
  });

  it("adds related tickers the user holds, and ignores ones they don't", () => {
    const article = { ...a("u1", "2026-07-01T00:00:00Z"), relatedSymbols: ["MSFT", "TSLA"] };
    const [merged] = mergeAndDedupeNews(
      [{ symbol: "AAPL", articles: [article] }],
      new Set(["AAPL", "MSFT"]),
    );
    expect(merged!.matchedSymbols.sort()).toEqual(["AAPL", "MSFT"]); // TSLA not held
  });
});

describe("pickStaleNewsSymbols", () => {
  it("prioritises never-fetched, then oldest past TTL, capped at budget", () => {
    const now = new Date("2026-07-23T12:00:00Z");
    const old = new Date("2026-07-23T11:00:00Z"); // 1h old > 30m TTL
    const fresh = new Date("2026-07-23T11:50:00Z"); // 10m old < 30m TTL
    const picked = pickStaleNewsSymbols(
      new Map([
        ["NEW", null],
        ["OLD", old],
        ["FRESH", fresh],
      ]),
      now,
      30 * 60_000,
      5,
    );
    expect(picked).toContain("NEW");
    expect(picked).toContain("OLD");
    expect(picked).not.toContain("FRESH");
  });
});

const NOW = new Date("2026-07-25T12:00:00Z");

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

function merged(over: Partial<MergedNewsArticle> = {}): MergedNewsArticle {
  return {
    title: "T",
    publisher: "P",
    publishedAt: hoursAgo(1),
    thumbnailUrl: null,
    relatedSymbols: ["AAPL"],
    matchedSymbols: ["AAPL"],
    ...over,
    // After the spread on purpose: callers pass a bare slug as `url` and this
    // expands it, so `over.url` must not win.
    url: "https://example.com/" + (over.url ?? "a"),
  };
}

function holding(over: Partial<NewsHolding> = {}): NewsHolding {
  return {
    symbol: "AAPL",
    name: "Apple Inc",
    weight: 0.5,
    dayChangePercent: 0,
    website: null,
    ...over,
  };
}

describe("rankPortfolioNews", () => {
  it("ranks the bigger position first when age and everything else match", () => {
    const out = rankPortfolioNews(
      [
        merged({ url: "small", matchedSymbols: ["O"], relatedSymbols: ["O"] }),
        merged({ url: "big", matchedSymbols: ["AAPL"], relatedSymbols: ["AAPL"] }),
      ],
      [
        holding({ symbol: "AAPL", weight: 0.8 }),
        holding({ symbol: "O", name: "Realty", weight: 0.05 }),
      ],
      NOW,
    );
    expect(out.map((x) => x.holding.symbol)).toEqual(["AAPL", "O"]);
  });

  it("lets a big mover on a small position beat a quiet large one", () => {
    const out = rankPortfolioNews(
      [
        merged({ url: "quiet", matchedSymbols: ["AAPL"], relatedSymbols: ["AAPL"] }),
        merged({ url: "mover", matchedSymbols: ["O"], relatedSymbols: ["O"] }),
      ],
      [
        holding({ symbol: "AAPL", weight: 0.5, dayChangePercent: 0 }),
        holding({ symbol: "O", name: "Realty", weight: 0.45, dayChangePercent: -8 }),
      ],
      NOW,
    );
    expect(out[0]!.holding.symbol).toBe("O");
  });

  it("demotes a many-ticker roundup below a single-ticker story of equal age and weight", () => {
    const out = rankPortfolioNews(
      [
        merged({
          url: "roundup",
          relatedSymbols: ["AAPL", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"],
          matchedSymbols: ["AAPL"],
        }),
        merged({ url: "focused", relatedSymbols: ["AAPL"], matchedSymbols: ["AAPL"] }),
      ],
      [holding({ symbol: "AAPL", weight: 0.8 })],
      NOW,
    );
    expect(out.map((x) => x.url)).toEqual([
      "https://example.com/focused",
      "https://example.com/roundup",
    ]);
  });

  it("decays with age — a fresh story outranks a two-day-old identical one", () => {
    const out = rankPortfolioNews(
      [
        merged({ url: "old", publishedAt: hoursAgo(48) }),
        merged({ url: "fresh", publishedAt: hoursAgo(1) }),
      ],
      [holding({ weight: 0.8 })],
      NOW,
    );
    expect(out.map((x) => x.url)).toEqual(["https://example.com/fresh", "https://example.com/old"]);
  });

  it("drops anything older than the 14-day cutoff", () => {
    const out = rankPortfolioNews(
      [merged({ url: "ancient", publishedAt: hoursAgo(15 * 24) }), merged({ url: "recent" })],
      [holding({ weight: 0.8 })],
      NOW,
    );
    expect(out.map((x) => x.url)).toEqual(["https://example.com/recent"]);
  });

  it("treats a null day change as zero rather than NaN", () => {
    const out = rankPortfolioNews(
      [merged()],
      [holding({ weight: 0.8, dayChangePercent: null })],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.holding.dayChangePercent).toBeNull();
  });

  it("falls back to recency order when every weight is zero", () => {
    const out = rankPortfolioNews(
      [
        merged({ url: "newer", publishedAt: hoursAgo(1) }),
        merged({ url: "older", publishedAt: hoursAgo(5) }),
      ],
      [holding({ weight: 0, dayChangePercent: null })],
      NOW,
    );
    expect(out.map((x) => x.url)).toEqual([
      "https://example.com/newer",
      "https://example.com/older",
    ]);
  });

  it("attributes to the largest matched holding and lists the rest", () => {
    const [only] = rankPortfolioNews(
      [merged({ matchedSymbols: ["O", "AAPL"], relatedSymbols: ["O", "AAPL"] })],
      [
        holding({ symbol: "AAPL", weight: 0.8 }),
        holding({ symbol: "O", name: "Realty", weight: 0.1 }),
      ],
      NOW,
    );
    expect(only!.holding.symbol).toBe("AAPL");
    expect(only!.holding.weightPct).toBe(80);
    expect(only!.otherSymbols).toEqual(["O"]);
  });

  it("drops an article whose matched symbols are no longer held", () => {
    const out = rankPortfolioNews(
      [merged({ matchedSymbols: ["GONE"], relatedSymbols: ["GONE"] })],
      [holding({ symbol: "AAPL", weight: 0.8 })],
      NOW,
    );
    expect(out).toEqual([]);
  });
});

describe("getPortfolioNews's rank-then-cap composition", () => {
  it("keeps a high-relevance article that is older than a wave of low-relevance noise out of a full pool", () => {
    const NOISE_COUNT = 54; // + 1 high-relevance article = 55, more than NEWS_FEED_CAP (50)
    const held = new Set(["AAPL", ...Array.from({ length: NOISE_COUNT }, (_, i) => `L${i}`)]);
    const lists = [
      { symbol: "AAPL", articles: [a("old-important", hoursAgo(300))] }, // 12.5 days old, still within the 14-day cutoff
      ...Array.from({ length: NOISE_COUNT }, (_, i) => ({
        symbol: `L${i}`,
        articles: [a(`noise-${i}`, hoursAgo(0.1))], // freshly published
      })),
    ];
    const holdings = [
      holding({ symbol: "AAPL", weight: 0.9 }),
      ...Array.from({ length: NOISE_COUNT }, (_, i) =>
        holding({ symbol: `L${i}`, weight: 0.0001 }),
      ),
    ];

    // This is the composition getPortfolioNews now uses: merge uncapped,
    // rank the full pool, cap only after ranking.
    const rankedThenCapped = rankPortfolioNews(
      mergeAndDedupeNews(lists, held, Infinity),
      holdings,
      NOW,
    ).slice(0, NEWS_FEED_CAP);
    expect(rankedThenCapped.map((r) => r.url)).toContain("old-important");

    // Proves the bug this composition fixes: capping the merge first (the
    // old order, and mergeAndDedupeNews's own default) discards the
    // high-relevance article before it is ever scored, no matter how
    // relevant it is.
    const cappedThenRanked = rankPortfolioNews(mergeAndDedupeNews(lists, held), holdings, NOW);
    expect(cappedThenRanked.map((r) => r.url)).not.toContain("old-important");
  });
});

describe("buildNewsHoldings", () => {
  const pos = (symbol: string, amount: string | null, currency = "USD") => ({
    symbol,
    name: symbol,
    marketValue: amount === null ? null : { amount, currency },
    dailyChangePercent: null,
    website: null,
  });

  it("weights each holding by its share of total market value", () => {
    const out = buildNewsHoldings([pos("AAPL", "800"), pos("O", "200")]);
    expect(out.find((h) => h.symbol === "AAPL")!.weight).toBeCloseTo(0.8, 6);
    expect(out.find((h) => h.symbol === "O")!.weight).toBeCloseTo(0.2, 6);
  });

  it("gives an unpriced position zero weight without breaking the others", () => {
    const out = buildNewsHoldings([pos("AAPL", "900"), pos("MYSTERY", null)]);
    expect(out.find((h) => h.symbol === "AAPL")!.weight).toBeCloseTo(1, 6);
    expect(out.find((h) => h.symbol === "MYSTERY")!.weight).toBe(0);
  });

  it("zeroes every weight when values do not resolve to one currency", () => {
    const out = buildNewsHoldings([pos("AAPL", "800", "USD"), pos("SHEL", "200", "GBP")]);
    expect(out.map((h) => h.weight)).toEqual([0, 0]);
  });

  it("returns zero weights rather than NaN when nothing is priced", () => {
    const out = buildNewsHoldings([pos("AAPL", null), pos("O", null)]);
    expect(out.map((h) => h.weight)).toEqual([0, 0]);
  });

  it("carries symbol, name, day change and website through", () => {
    const [only] = buildNewsHoldings([
      {
        symbol: "AAPL",
        name: "Apple Inc",
        marketValue: { amount: "100", currency: "USD" },
        dailyChangePercent: -2.4,
        website: "https://apple.com",
      },
    ]);
    expect(only).toEqual({
      symbol: "AAPL",
      name: "Apple Inc",
      weight: 1,
      dayChangePercent: -2.4,
      website: "https://apple.com",
    });
  });
});
