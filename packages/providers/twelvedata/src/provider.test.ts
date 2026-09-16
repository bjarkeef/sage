import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ProviderPlanLimitError, SymbolNotFoundError } from "@sage/provider-interface";
import { TwelveDataProvider } from "./provider";
import {
  AAPL_DIVIDENDS,
  AAPL_PROFILE,
  AAPL_QUOTE,
  AAPL_TIME_SERIES,
  ERROR_ENDPOINT_PLAN,
  ERROR_NO_DATA,
  SEARCH_RESULTS,
} from "./fixtures";

const BASE = "https://twelvedata.test";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function provider(creditsPerMinute = 100) {
  return new TwelveDataProvider({ apiKey: "test-key", baseUrl: BASE, creditsPerMinute });
}

function capture(path: string, body: Record<string, unknown>, status = 200) {
  const params: URLSearchParams[] = [];
  server.use(
    http.get(`${BASE}/${path}`, ({ request }) => {
      params.push(new URL(request.url).searchParams);
      return HttpResponse.json(body, { status });
    }),
  );
  return params;
}

describe("TwelveDataProvider.getQuote", () => {
  it("asks for the listing on its MIC and answers under the app symbol", async () => {
    const seen = capture("quote", { ...AAPL_QUOTE, symbol: "EUDIV", currency: "EUR" });
    const q = await provider().getQuote("EUDIV.DE");
    expect(seen[0]!.get("symbol")).toBe("EUDIV");
    expect(seen[0]!.get("mic_code")).toBe("XETR");
    expect(q.symbol).toBe("EUDIV.DE");
    expect(q.price.currency).toBe("EUR");
  });

  it("throws SymbolNotFoundError for a suffix it cannot place, without calling out", async () => {
    await expect(provider().getQuote("FOO.WAR")).rejects.toBeInstanceOf(SymbolNotFoundError);
  });
});

describe("TwelveDataProvider.getHistoricalPrices", () => {
  it("requests daily split-adjusted bars for the range, oldest first", async () => {
    const seen = capture("time_series", AAPL_TIME_SERIES);
    const bars = await provider().getHistoricalPrices(
      "AAPL",
      new Date("2026-09-15T00:00:00Z"),
      new Date("2026-09-16T00:00:00Z"),
    );
    expect(seen[0]!.get("interval")).toBe("1day");
    expect(seen[0]!.get("adjust")).toBe("splits");
    expect(seen[0]!.get("start_date")).toBe("2026-09-15");
    expect(seen[0]!.get("end_date")).toBe("2026-09-16");
    expect(seen[0]!.has("mic_code")).toBe(false);
    expect(bars.map((b) => b.date.toISOString().slice(0, 10))).toEqual([
      "2026-09-15",
      "2026-09-16",
    ]);
  });

  it("returns no bars when Twelve Data has none for the range", async () => {
    capture("time_series", ERROR_NO_DATA, 400);
    await expect(
      provider().getHistoricalPrices("AAPL", new Date("1990-01-01"), new Date("1990-01-02")),
    ).resolves.toEqual([]);
  });
});

describe("TwelveDataProvider.getDividendHistory", () => {
  it("requests the full range", async () => {
    const seen = capture("dividends", AAPL_DIVIDENDS);
    const divs = await provider().getDividendHistory("AAPL");
    expect(seen[0]!.get("range")).toBe("full");
    expect(divs).toHaveLength(2);
    expect(divs[0]!.symbol).toBe("AAPL");
  });

  it("surfaces a plan refusal so the fallback can serve it", async () => {
    capture("dividends", ERROR_ENDPOINT_PLAN, 403);
    await expect(provider().getDividendHistory("VOO")).rejects.toBeInstanceOf(
      ProviderPlanLimitError,
    );
  });
});

describe("TwelveDataProvider.getAssetProfile", () => {
  it("combines /profile with /quote", async () => {
    capture("profile", AAPL_PROFILE);
    capture("quote", AAPL_QUOTE);
    const p = await provider().getAssetProfile("AAPL");
    expect(p.symbol).toBe("AAPL");
    expect(p.currency).toBe("USD");
    expect(p.countryIso).toBe("US");
  });

  it("does not spend a quote credit when the profile is refused", async () => {
    capture(
      "profile",
      {
        ...ERROR_ENDPOINT_PLAN,
        message: ERROR_ENDPOINT_PLAN.message.replace("/dividends", "/profile"),
      },
      403,
    );
    const quotes = capture("quote", AAPL_QUOTE);
    await expect(provider().getAssetProfile("VOO")).rejects.toBeInstanceOf(ProviderPlanLimitError);
    expect(quotes).toHaveLength(0);
  });
});

describe("TwelveDataProvider.searchSymbol", () => {
  it("returns Sage symbols only for venues Sage can price", async () => {
    const seen = capture("symbol_search", SEARCH_RESULTS);
    const results = await provider().searchSymbol("nordlas");
    expect(seen[0]!.get("symbol")).toBe("nordlas");
    expect(results.map((r) => r.symbol)).toEqual(["NORDLAS-B.ST", "THAMES.L", "VOO"]);
  });
});
