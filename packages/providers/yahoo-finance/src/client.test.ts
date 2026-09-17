import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ProviderRateLimitError,
  ProviderUnavailableError,
  SymbolNotFoundError,
} from "@sage/provider-interface";

/**
 * Mocks the `yahoo-finance2` module rather than the network, because the
 * library owns its own crumb/cookie/fetch pipeline — there is no HTTP
 * boundary to intercept the way there is for EODHD's plain `fetch`.
 *
 * The rejection messages below are not invented: they were captured by
 * running a real, disposable script against the live Yahoo Finance API with
 * a bogus ticker (`ZZZZNOTAREALTICKER.XX`) on yahoo-finance2@4.0.2, the
 * version this workspace's catalog pins. Findings, verbatim:
 *
 * - `quote(unknownSymbol)` does NOT throw. It resolves `undefined` (the
 *   library filters unknown/delisted results out of its internal array and
 *   then indexes into it, so a single unknown symbol yields `results[0]` ===
 *   undefined). This is why `YahooFinanceClient.quote` has its own
 *   `if (!raw) throw new SymbolNotFoundError(symbol)` check below `wrap` —
 *   `wrap`'s catch block never runs for this case because nothing throws.
 * - `chart(unknownSymbol)` throws a plain `Error` with message
 *   "No data found, symbol may be delisted" — yahoo-finance2's own JSDoc for
 *   `chart()` recommends matching this exact substring.
 * - `quoteSummary(unknownSymbol)` throws a plain `Error` with message
 *   "Quote not found for symbol: <SYMBOL>" — this is Yahoo's backend
 *   `error.description` passed straight through by the library; there is no
 *   dedicated error class for it (yahoo-finance2's internal error-class
 *   lookup falls back to a bare `Error` because it does not define a
 *   `NotFoundError` class), so message matching is the only option.
 */
const { quoteMock, chartMock, quoteSummaryMock, searchMock, constructedWith } = vi.hoisted(() => ({
  quoteMock: vi.fn(),
  chartMock: vi.fn(),
  quoteSummaryMock: vi.fn(),
  searchMock: vi.fn(),
  constructedWith: [] as { fetch?: typeof fetch }[],
}));

vi.mock("yahoo-finance2", () => ({
  default: class FakeYahooFinance {
    constructor(options: { fetch?: typeof fetch } = {}) {
      constructedWith.push(options);
    }
    quote = quoteMock;
    chart = chartMock;
    quoteSummary = quoteSummaryMock;
    search = searchMock;
  },
}));

import { YahooFinanceClient } from "./client";

beforeEach(() => {
  quoteMock.mockReset();
  chartMock.mockReset();
  quoteSummaryMock.mockReset();
  searchMock.mockReset();
});

describe("YahooFinanceClient: request timeout", () => {
  it("hands yahoo-finance2 a fetch that gives up on a request that never answers", async () => {
    constructedWith.length = 0;
    new YahooFinanceClient({ timeoutMs: 20 });
    const libraryFetch = constructedWith[0]?.fetch;
    expect(libraryFetch).toBeTypeOf("function");

    const original = globalThis.fetch;
    globalThis.fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason as Error));
      });
    try {
      const err = await libraryFetch!("https://query2.finance.yahoo.test/").catch(
        (x: unknown) => x,
      );
      expect((err as Error).name).toBe("TimeoutError");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("YahooFinanceClient.quote", () => {
  it("throws SymbolNotFoundError when yahoo-finance2 resolves undefined", async () => {
    quoteMock.mockResolvedValue(undefined);
    await expect(new YahooFinanceClient().quote("NOPE")).rejects.toBeInstanceOf(
      SymbolNotFoundError,
    );
  });

  it("returns the quote unchanged when found", async () => {
    const raw = {
      symbol: "AAPL",
      regularMarketPrice: 195.5,
      currency: "USD",
      exchange: "NMS",
      quoteType: "EQUITY",
    };
    quoteMock.mockResolvedValue(raw);
    await expect(new YahooFinanceClient().quote("AAPL")).resolves.toBe(raw);
  });
});

describe("YahooFinanceClient.chart", () => {
  it("throws SymbolNotFoundError for yahoo-finance2's 'No data found' signal", async () => {
    chartMock.mockRejectedValue(new Error("No data found, symbol may be delisted"));
    await expect(
      new YahooFinanceClient().chart("NOPE", new Date(), new Date()),
    ).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it("maps a 429 message to ProviderRateLimitError", async () => {
    chartMock.mockRejectedValue(new Error("Too Many Requests"));
    await expect(
      new YahooFinanceClient().chart("AAPL", new Date(), new Date()),
    ).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it("maps an unrecognised failure to ProviderUnavailableError", async () => {
    chartMock.mockRejectedValue(new Error("socket hang up"));
    await expect(
      new YahooFinanceClient().chart("AAPL", new Date(), new Date()),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

describe("YahooFinanceClient.quoteSummary", () => {
  it("throws SymbolNotFoundError for yahoo-finance2's 'Quote not found for symbol' signal", async () => {
    quoteSummaryMock.mockRejectedValue(new Error("Quote not found for symbol: NOPE"));
    await expect(new YahooFinanceClient().quoteSummary("NOPE")).rejects.toBeInstanceOf(
      SymbolNotFoundError,
    );
  });
});
