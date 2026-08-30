import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SymbolNotFoundError } from "@sage/provider-interface";
import { EodhdProvider } from "./provider";

const BASE = "https://eodhd.test/api";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function provider() {
  return new EodhdProvider({ apiToken: "test-token", baseUrl: BASE });
}

/** Stub the fundamentals filter endpoint used by resolveCurrency. */
function stubCurrency(sym: string, currency: string) {
  server.use(
    http.get(`${BASE}/v1.1/fundamentals/${sym}`, ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("filter") === "General::CurrencyCode") {
        return HttpResponse.text(`"${currency}"`);
      }
      // Non-filter fundamentals calls are handled by other handlers
      return HttpResponse.json({
        General: {
          Code: sym.split(".")[0],
          Name: "Test",
          Exchange: "US",
          CurrencyCode: currency,
        },
      });
    }),
  );
}

describe("EodhdProvider.getQuote", () => {
  it("returns a mapped quote", async () => {
    const sym = "AAPL.US";
    stubCurrency(sym, "USD");
    server.use(
      http.get(`${BASE}/real-time/${sym}`, () =>
        HttpResponse.json({
          code: "AAPL",
          timestamp: 1719500000,
          gmtoffset: 0,
          open: 190,
          high: 195,
          low: 189,
          close: 193.5,
          volume: 50000000,
        }),
      ),
    );

    const p = provider();
    const q = await p.getQuote("AAPL");
    expect(q.symbol).toBe("AAPL");
    expect(q.price.toJSON()).toEqual({ amount: "193.5", currency: "USD" });
  });

  it("throws SymbolNotFoundError for zero-close/zero-volume", async () => {
    const sym = "FAKE.US";
    stubCurrency(sym, "USD");
    server.use(
      http.get(`${BASE}/real-time/${sym}`, () =>
        HttpResponse.json({
          code: "FAKE",
          timestamp: 0,
          gmtoffset: 0,
          open: 0,
          high: 0,
          low: 0,
          close: 0,
          volume: 0,
        }),
      ),
    );
    await expect(provider().getQuote("FAKE")).rejects.toBeInstanceOf(SymbolNotFoundError);
  });
});

describe("EodhdProvider.getHistoricalPrices", () => {
  it("returns mapped price bars", async () => {
    const sym = "AAPL.US";
    stubCurrency(sym, "USD");
    server.use(
      http.get(`${BASE}/eod/${sym}`, () =>
        HttpResponse.json([
          {
            date: "2026-06-25",
            open: 190,
            high: 195,
            low: 189,
            close: 192,
            adjusted_close: 192,
            volume: 40000000,
          },
          {
            date: "2026-06-26",
            open: 192,
            high: 196,
            low: 191,
            close: 195,
            adjusted_close: 195,
            volume: 45000000,
          },
        ]),
      ),
    );

    const bars = await provider().getHistoricalPrices(
      "AAPL",
      new Date("2026-06-25"),
      new Date("2026-06-26"),
    );
    expect(bars).toHaveLength(2);
    expect(bars[0]!.close.toJSON()).toEqual({ amount: "192", currency: "USD" });
  });

  it("returns empty array when no bars", async () => {
    const sym = "EMPTY.US";
    server.use(http.get(`${BASE}/eod/${sym}`, () => HttpResponse.json([])));
    const bars = await provider().getHistoricalPrices("EMPTY", new Date(), new Date());
    expect(bars).toEqual([]);
  });
});

describe("EodhdProvider.getDividendHistory", () => {
  it("returns mapped dividends", async () => {
    const sym = "AAPL.US";
    stubCurrency(sym, "USD");
    server.use(
      http.get(`${BASE}/div/${sym}`, () =>
        HttpResponse.json([
          {
            date: "2026-05-10",
            value: 0.25,
            currency: "USD",
            paymentDate: "2026-05-30",
            declarationDate: "2026-04-15",
          },
        ]),
      ),
    );
    const divs = await provider().getDividendHistory("AAPL");
    expect(divs).toHaveLength(1);
    expect(divs[0]!.amountPerShare.toJSON()).toEqual({ amount: "0.25", currency: "USD" });
  });

  it("uses each row's own currency and never calls the paywalled fundamentals endpoint", async () => {
    // Deliberately do NOT register a /v1.1/fundamentals handler. onUnhandledRequest:
    // "error" means if getDividendHistory ever calls resolveCurrency, this test fails.
    const sym = "BRITIDX.LSE";
    server.use(
      http.get(`${BASE}/div/${sym}`, () =>
        HttpResponse.json([
          {
            date: "2026-05-10",
            value: 0.3,
            currency: "GBP",
            paymentDate: "2026-05-30",
            declarationDate: "2026-04-15",
          },
          {
            date: "2026-02-10",
            value: 0.28,
            currency: "GBP",
            paymentDate: "2026-02-28",
            declarationDate: "2026-01-15",
          },
        ]),
      ),
    );

    const divs = await provider().getDividendHistory("BRITIDX.L");
    expect(divs).toHaveLength(2);
    expect(divs[0]!.amountPerShare.toJSON()).toEqual({ amount: "0.3", currency: "GBP" });
    expect(divs[1]!.amountPerShare.toJSON()).toEqual({ amount: "0.28", currency: "GBP" });
  });

  it("does not sink the whole fetch when a currency-less row's fundamentals fallback 403s", async () => {
    const sym = "AAPL.US";
    server.use(
      http.get(`${BASE}/div/${sym}`, () =>
        HttpResponse.json([
          {
            date: "2026-05-10",
            value: 0.25,
            currency: "USD",
            paymentDate: "2026-05-30",
            declarationDate: "2026-04-15",
          },
          {
            // No currency on this row -- forces the fallback path, which then 403s.
            date: "2026-02-10",
            value: 0.24,
            paymentDate: "2026-02-28",
            declarationDate: "2026-01-15",
          },
        ]),
      ),
      http.get(`${BASE}/v1.1/fundamentals/${sym}`, () => HttpResponse.json({}, { status: 403 })),
    );

    const divs = await provider().getDividendHistory("AAPL");
    expect(divs).toHaveLength(1);
    expect(divs[0]!.amountPerShare.toJSON()).toEqual({ amount: "0.25", currency: "USD" });
  });
});

describe("EodhdProvider.searchSymbol", () => {
  it("returns mapped search results", async () => {
    server.use(
      http.get(`${BASE}/search/apple`, () =>
        HttpResponse.json([
          {
            Code: "AAPL",
            Exchange: "US",
            Name: "Apple Inc",
            Type: "Common Stock",
            Country: "USA",
            Currency: "USD",
          },
        ]),
      ),
    );
    const results = await provider().searchSymbol("apple");
    expect(results).toHaveLength(1);
    expect(results[0]!.symbol).toBe("AAPL");
    expect(results[0]!.assetType).toBe("stock");
  });
});

describe("EodhdProvider symbol translation", () => {
  it("translates app suffixes to EODHD exchanges in request paths", async () => {
    const sym = "EUDIV.XETRA";
    stubCurrency(sym, "EUR");
    server.use(
      http.get(`${BASE}/real-time/${sym}`, () =>
        HttpResponse.json({
          code: "EUDIV",
          timestamp: 1751500000,
          gmtoffset: 0,
          open: 51,
          high: 52,
          low: 50.5,
          close: 51.9,
          volume: 1000,
          previousClose: 51.5,
        }),
      ),
    );

    const q = await provider().getQuote("EUDIV.DE");
    expect(q.symbol).toBe("EUDIV");
    expect(q.price.toJSON()).toEqual({ amount: "51.9", currency: "EUR" });
  });

  it("round-trips a suffixed symbol through searchSymbol (XETRA -> .DE app symbol)", async () => {
    server.use(
      http.get(`${BASE}/search/eudiv`, () =>
        HttpResponse.json([
          {
            Code: "EUDIV",
            Exchange: "XETRA",
            Name: "Euro High Dividend Yield UCITS ETF",
            Type: "ETF",
            Country: "Germany",
            Currency: "EUR",
          },
        ]),
      ),
    );

    const results = await provider().searchSymbol("eudiv");
    expect(results).toHaveLength(1);
    expect(results[0]!.symbol).toBe("EUDIV.DE");
  });
});

describe("EodhdProvider.getAssetProfile", () => {
  it("returns a mapped asset profile", async () => {
    const sym = "AAPL.US";
    server.use(
      http.get(`${BASE}/v1.1/fundamentals/${sym}`, () =>
        HttpResponse.json({
          General: {
            Code: "AAPL",
            Name: "Apple Inc",
            Exchange: "NASDAQ",
            CurrencyCode: "USD",
            CountryName: "USA",
            CountryISO: "US",
            Sector: "Technology",
            Industry: "Consumer Electronics",
            Type: "Common Stock",
          },
          Highlights: { MarketCapitalization: 3000000000000, PERatio: 32.5, DividendYield: 0.52 },
          Technicals: { Beta: 1.28, "52WeekHigh": 237.49, "52WeekLow": 164.08 },
          SplitsDividends: { TrailingAnnualDividendRate: 1.0 },
        }),
      ),
    );
    const profile = await provider().getAssetProfile("AAPL");
    expect(profile.symbol).toBe("AAPL");
    expect(profile.country).toBe("USA");
    expect(profile.countryIso).toBe("US");
    expect(profile.sector).toBe("Technology");
  });
});
