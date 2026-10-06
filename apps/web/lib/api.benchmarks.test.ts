// @vitest-environment jsdom
// jsdom, so react-query's `isServer` is false and `apiFetch` takes the browser
// path (a plain `fetch`) instead of reading `next/headers` cookies.
import { describe, it, expect, vi, afterEach } from "vitest";
import { getBenchmarks, getBenchmarkSeries } from "./api";
import { qk } from "./query/keys";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("benchmark fetchers", () => {
  it("unwraps the benchmark list", async () => {
    stubFetch({ benchmarks: [{ id: "sp500", name: "S&P 500 (TR)" }] });
    expect(await getBenchmarks()).toEqual([{ id: "sp500", name: "S&P 500 (TR)" }]);
  });

  it("asks for one series by id, window and the holding's currency, and passes an unavailable series through with its reason", async () => {
    const fetchMock = stubFetch({ series: null, reason: "no_fx_rate" });
    expect(await getBenchmarkSeries("sp500", "2026-03-01", "2026-03-10", "EUR")).toEqual({
      series: null,
      reason: "no_fx_rate",
    });
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/benchmarks/series?");
    expect(url).toContain("id=sp500");
    expect(url).toContain("from=2026-03-01");
    expect(url).toContain("to=2026-03-10");
    expect(url).toContain("currency=EUR");
  });

  it("returns a converted series as sent", async () => {
    const series = {
      id: "sp500",
      name: "S&P 500 (TR)",
      currency: "EUR",
      bars: [{ date: "2026-03-02", close: "100" }],
    };
    stubFetch({ series, reason: null });
    expect(await getBenchmarkSeries("sp500", "2026-03-01", "2026-03-10", "EUR")).toEqual({
      series,
      reason: null,
    });
  });

  it("throws on a failed request rather than reading it as unavailable", async () => {
    stubFetch({ error: "unknown_benchmark" }, 400);
    await expect(getBenchmarkSeries("x", "2026-03-01", "2026-03-10", "EUR")).rejects.toThrow();
  });

  it("keys a series by id, window and currency", () => {
    expect(qk.benchmarkSeries("sp500", "2026-03-01", "2026-03-10", "EUR")).toEqual([
      "benchmark-series",
      "sp500",
      "2026-03-01",
      "2026-03-10",
      "EUR",
    ]);
  });
});
