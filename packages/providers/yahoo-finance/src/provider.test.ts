import { describe, it, expect } from "vitest";
import { SymbolNotFoundError } from "@sage/provider-interface";
import { YahooFinanceProvider } from "./provider";
import type { YahooFinanceProviderClient } from "./provider";
import type { YfQuote, YfChartResult, YfSearchResult } from "./client";

function makeQuote(overrides: Partial<YfQuote> = {}): YfQuote {
  return {
    symbol: "AAPL",
    regularMarketPrice: 195.5,
    regularMarketTime: new Date("2026-06-20T16:00:00Z"),
    currency: "USD",
    exchange: "NMS",
    quoteType: "EQUITY",
    ...overrides,
  };
}

function makeChart(overrides: Partial<YfChartResult> = {}): YfChartResult {
  return {
    meta: { currency: "USD", symbol: "AAPL", exchangeName: "NasdaqGS" },
    quotes: [
      {
        date: new Date("2026-06-18"),
        open: 190,
        high: 195,
        low: 189,
        close: 194,
        volume: 40_000_000,
      },
      {
        date: new Date("2026-06-19"),
        open: 194,
        high: 197,
        low: 193,
        close: 196,
        volume: 45_000_000,
      },
    ],
    ...overrides,
  };
}

function makeSearchResult(overrides: Partial<YfSearchResult> = {}): YfSearchResult {
  return {
    quotes: [
      {
        symbol: "AAPL",
        exchange: "NMS",
        longname: "Apple Inc.",
        quoteType: "EQUITY",
        isYahooFinance: true,
      },
      {
        symbol: "AAPL.MX",
        exchange: "MEX",
        shortname: "Apple Inc.",
        quoteType: "EQUITY",
        isYahooFinance: true,
      },
    ],
    ...overrides,
  };
}

function mockClient(
  overrides: Partial<YahooFinanceProviderClient> = {},
): YahooFinanceProviderClient {
  return {
    quote: () => Promise.resolve(makeQuote()),
    chart: () => Promise.resolve(makeChart()),
    search: () => Promise.resolve(makeSearchResult()),
    news: () => Promise.resolve([]),
    ratingsSummary: () => Promise.resolve({}),
    ...overrides,
  };
}

describe("getQuote", () => {
  it("returns a well-formed Quote", async () => {
    const provider = new YahooFinanceProvider(mockClient());
    const q = await provider.getQuote("AAPL");
    expect(q.symbol).toBe("AAPL");
    expect(q.price.amount.greaterThan(0)).toBe(true);
    expect(q.price.currency).toBe("USD");
    expect(q.asOf).toBeInstanceOf(Date);
  });

  it("throws SymbolNotFoundError when price is missing", async () => {
    const client = mockClient({
      quote: () => Promise.resolve(makeQuote({ regularMarketPrice: undefined })),
    });
    const provider = new YahooFinanceProvider(client);
    await expect(provider.getQuote("NOPE")).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it("throws SymbolNotFoundError when currency is missing", async () => {
    const client = mockClient({
      quote: () => Promise.resolve(makeQuote({ currency: undefined })),
    });
    const provider = new YahooFinanceProvider(client);
    await expect(provider.getQuote("NOPE")).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it("propagates a SymbolNotFoundError thrown by the client unchanged", async () => {
    // The real client throws this itself (see client.test.ts) rather than
    // returning a value mapQuote rejects. The provider must not wrap or
    // replace it — HealthTrackingProvider's instanceof check, and every
    // downstream fallback branch, depend on identity being preserved end to
    // end, not just at the decorator.
    const notFound = new SymbolNotFoundError("NOPE");
    const client = mockClient({ quote: () => Promise.reject(notFound) });
    const provider = new YahooFinanceProvider(client);
    await expect(provider.getQuote("NOPE")).rejects.toBe(notFound);
  });
});

describe("getHistoricalPrices", () => {
  it("returns ascending PriceBars", async () => {
    const provider = new YahooFinanceProvider(mockClient());
    const bars = await provider.getHistoricalPrices(
      "AAPL",
      new Date("2026-06-01"),
      new Date("2026-06-30"),
    );
    expect(bars).toHaveLength(2);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.date.getTime()).toBeGreaterThanOrEqual(bars[i - 1]!.date.getTime());
    }
  });

  it("skips bars with null fields", async () => {
    const client = mockClient({
      chart: () =>
        Promise.resolve(
          makeChart({
            quotes: [
              {
                date: new Date("2026-06-18"),
                open: 190,
                high: 195,
                low: 189,
                close: 194,
                volume: 40_000_000,
              },
              {
                date: new Date("2026-06-19"),
                open: null,
                high: null,
                low: null,
                close: null,
                volume: null,
              },
            ],
          }),
        ),
    });
    const provider = new YahooFinanceProvider(client);
    const bars = await provider.getHistoricalPrices(
      "AAPL",
      new Date("2026-06-01"),
      new Date("2026-06-30"),
    );
    expect(bars).toHaveLength(1);
  });

  it("returns empty array when no quotes", async () => {
    const client = mockClient({ chart: () => Promise.resolve(makeChart({ quotes: [] })) });
    const provider = new YahooFinanceProvider(client);
    const bars = await provider.getHistoricalPrices(
      "AAPL",
      new Date("2026-06-01"),
      new Date("2026-06-30"),
    );
    expect(bars).toEqual([]);
  });

  it("propagates a SymbolNotFoundError thrown by the client unchanged", async () => {
    // The real client's chart() throws this itself for an unknown symbol
    // (yahoo-finance2's "No data found" signal — see client.test.ts).
    const notFound = new SymbolNotFoundError("NOPE");
    const client = mockClient({ chart: () => Promise.reject(notFound) });
    const provider = new YahooFinanceProvider(client);
    await expect(
      provider.getHistoricalPrices("NOPE", new Date("2026-06-01"), new Date("2026-06-30")),
    ).rejects.toBe(notFound);
  });
});

describe("getDividendHistory", () => {
  it("maps dividend events from chart", async () => {
    const client = mockClient({
      chart: () =>
        Promise.resolve(
          makeChart({
            events: {
              dividends: [
                { amount: 0.25, date: new Date("2026-02-10") },
                { amount: 0.25, date: new Date("2026-05-10") },
              ],
            },
          }),
        ),
    });
    const provider = new YahooFinanceProvider(client);
    const divs = await provider.getDividendHistory("AAPL");
    expect(divs).toHaveLength(2);
    expect(divs[0]!.symbol).toBe("AAPL");
    expect(divs[0]!.amountPerShare.amount.greaterThan(0)).toBe(true);
    expect(divs[0]!.amountPerShare.currency).toBe("USD");
  });

  it("returns empty array when no dividend events", async () => {
    const provider = new YahooFinanceProvider(mockClient());
    const divs = await provider.getDividendHistory("AAPL");
    expect(divs).toEqual([]);
  });
});

describe("searchSymbol", () => {
  it("returns mapped results with known exchanges", async () => {
    const provider = new YahooFinanceProvider(mockClient());
    const results = await provider.searchSymbol("apple");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.symbol).toBe("AAPL");
    expect(results[0]!.currency).toBe("USD");
  });

  it("skips non-Yahoo results", async () => {
    const client = mockClient({
      search: () =>
        Promise.resolve({
          quotes: [
            {
              symbol: "AAPL",
              exchange: "NMS",
              longname: "Apple Inc.",
              quoteType: "EQUITY",
              isYahooFinance: true as const,
            },
            {
              symbol: "",
              exchange: "",
              isYahooFinance: false as const,
            },
          ],
        }),
    });
    const provider = new YahooFinanceProvider(client);
    const results = await provider.searchSymbol("apple");
    expect(results).toHaveLength(1);
  });

  it("drops results with unknown exchange", async () => {
    const client = mockClient({
      search: () =>
        Promise.resolve({
          quotes: [
            {
              symbol: "X",
              exchange: "UNKNOWN_EX",
              quoteType: "EQUITY",
              isYahooFinance: true as const,
            },
          ],
        }),
    });
    const provider = new YahooFinanceProvider(client);
    const results = await provider.searchSymbol("x");
    expect(results).toEqual([]);
  });
});

describe("YahooFinanceProvider news & ratings", () => {
  it("getNews maps the client's news array", async () => {
    const client = mockClient({
      news: () =>
        Promise.resolve([
          {
            title: "Headline",
            publisher: "WSJ",
            link: "https://x",
            providerPublishTime: new Date("2026-07-20T00:00:00Z"),
            relatedTickers: ["aapl"],
          },
        ]),
    });
    const provider = new YahooFinanceProvider(client);
    const news = await provider.getNews("AAPL");
    expect(news).toHaveLength(1);
    expect(news[0]!.publisher).toBe("WSJ");
    expect(news[0]!.relatedSymbols).toEqual(["AAPL"]);
  });

  it("getAnalystRatings returns null when the client has no coverage", async () => {
    const client = mockClient({
      ratingsSummary: () => Promise.resolve({ price: { currency: "USD" } }),
    });
    const provider = new YahooFinanceProvider(client);
    expect(await provider.getAnalystRatings("AAPL")).toBeNull();
  });

  it("getAnalystRatings maps a covered symbol", async () => {
    const client = mockClient({
      ratingsSummary: () =>
        Promise.resolve({
          recommendationTrend: {
            trend: [{ period: "0m", strongBuy: 2, buy: 1, hold: 0, sell: 0, strongSell: 0 }],
          },
          financialData: {
            targetMeanPrice: 100,
            numberOfAnalystOpinions: 3,
            recommendationKey: "strong_buy",
          },
          price: { currency: "USD" },
        }),
    });
    const provider = new YahooFinanceProvider(client);
    const r = (await provider.getAnalystRatings("AAPL"))!;
    expect(r.consensusKey).toBe("strongBuy");
    expect(r.analystCount).toBe(3);
    expect(r.targets.mean?.toJSON()).toEqual({ amount: "100", currency: "USD" });
  });
});
