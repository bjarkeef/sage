import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Decimal, Money } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { IHistoricalFxRateService, PriceBar } from "@sage/provider-interface";
import type { AppEnv } from "../middleware/session";
import { benchmarksRoutes } from "./benchmarks";

function bar(date: string, close: string): PriceBar {
  const m = Money.of(close, "USD");
  return {
    date: new Date(`${date}T00:00:00Z`),
    open: m,
    high: m,
    low: m,
    close: m,
    volume: new Decimal(0),
  };
}

// Dates here are request parameters, never compared with the real clock.
const provider = new FakeMarketDataProvider({
  history: {
    "SP500TR.INDX": [
      bar("2026-03-02", "110"),
      bar("2026-03-03", "121"),
      bar("2026-03-04", "132"),
      bar("2026-03-20", "99"),
    ],
  },
});

/**
 * ECB-style rates with EUR as the base: units of USD per 1 EUR, on exactly the
 * days given. Unlike the real `EcbFxRateService` it does NOT forward-fill, so a
 * gap here is a gap the route itself has to carry across.
 */
function ecbStub(usdPerEur: Record<string, string>) {
  const stub = {
    getRate: vi.fn(() =>
      Promise.reject(new Error("spot rates are not used for a benchmark series")),
    ),
    getRates: vi.fn(() => Promise.resolve(new Map())),
    getRateSeries: vi.fn((base: string) =>
      Promise.resolve({
        coversFrom: Object.keys(usdPerEur).sort()[0] ?? null,
        rateOn(date: string, currency: string) {
          if (base !== "EUR" || currency !== "USD") return null;
          const r = usdPerEur[date];
          return r ? new Decimal(r) : null;
        },
      }),
    ),
  } satisfies IHistoricalFxRateService;
  return stub;
}

function app(fx?: ReturnType<typeof ecbStub>) {
  const a = new Hono<AppEnv>();
  a.route("/benchmarks", benchmarksRoutes(provider, fx));
  return a;
}

const q = (over: Record<string, string> = {}) =>
  `/benchmarks/series?${new URLSearchParams({ id: "sp500", from: "2026-03-01", to: "2026-03-10", currency: "USD", ...over }).toString()}`;

describe("GET /benchmarks", () => {
  it("lists every benchmark by id and its total-return name, from BENCHMARKS itself", async () => {
    const res = await app().request("/benchmarks");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      benchmarks: [
        { id: "sp500", name: "S&P 500 (TR)" },
        { id: "msci-world", name: "MSCI World (TR)" },
      ],
    });
  });
});

describe("GET /benchmarks/series", () => {
  it("in the index's own currency, returns its closes inside the window untouched — no FX lookup", async () => {
    const fx = ecbStub({});
    const res = await app(fx).request(q());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      series: {
        id: "sp500",
        name: "S&P 500 (TR)",
        currency: "USD",
        bars: [
          { date: "2026-03-02", close: "110" },
          { date: "2026-03-03", close: "121" },
          { date: "2026-03-04", close: "132" },
        ],
      },
      reason: null,
    });
    expect(fx.getRateSeries).not.toHaveBeenCalled();
  });

  it("converts into the holding's currency at each day's ECB rate, carrying the last rate over a gap", async () => {
    // No rate on 03-03: it is converted at 03-02's 1.10, not dropped and not left in USD.
    const fx = ecbStub({ "2026-03-02": "1.10", "2026-03-04": "1.20" });
    const res = await app(fx).request(q({ currency: "EUR" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      series: {
        id: "sp500",
        name: "S&P 500 (TR)",
        currency: "EUR",
        bars: [
          { date: "2026-03-02", close: "100" }, // 110 / 1.10
          { date: "2026-03-03", close: "110" }, // 121 / 1.10, carried
          { date: "2026-03-04", close: "110" }, // 132 / 1.20
        ],
      },
      reason: null,
    });
    expect(fx.getRateSeries).toHaveBeenCalledWith("EUR", ["USD"], "2026-03-02", "2026-03-04");
  });

  it("answers null with a reason when no rate covers the range start — never an unconverted line", async () => {
    const res = await app(ecbStub({ "2026-03-03": "1.10" })).request(q({ currency: "EUR" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ series: null, reason: "no_fx_rate" });
  });

  it("answers the same when there is no FX service at all", async () => {
    const res = await app().request(q({ currency: "EUR" }));
    expect(await res.json()).toEqual({ series: null, reason: "no_fx_rate" });
  });

  it("answers null for a benchmark it cannot fetch — never a price-index fallback", async () => {
    const res = await app().request(q({ id: "msci-world" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ series: null, reason: "no_series" });
  });

  it("rejects an unknown benchmark", async () => {
    const res = await app().request(q({ id: "gspc" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_benchmark" });
  });

  it("rejects malformed or reversed dates and a missing or malformed currency", async () => {
    expect((await app().request(q({ from: "March" }))).status).toBe(400);
    expect((await app().request(q({ from: "2026-03-10", to: "2026-03-01" }))).status).toBe(400);
    expect(
      (await app().request("/benchmarks/series?id=sp500&from=2026-03-01&to=2026-03-10")).status,
    ).toBe(400);
    expect((await app().request(q({ currency: "eur" }))).status).toBe(400);
  });
});
