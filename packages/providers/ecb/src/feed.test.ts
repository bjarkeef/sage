import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import { EcbFxFeed } from "./feed";

const BASE = "https://ecb.test/stats/eurofxref";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const XML = `<Cube><Cube time="2026-08-07"><Cube currency="USD" rate="1.1535"/></Cube></Cube>`;

describe("EcbFxFeed", () => {
  it("fetches and parses the daily feed", async () => {
    server.use(http.get(`${BASE}/eurofxref-daily.xml`, () => HttpResponse.xml(XML)));
    const days = await new EcbFxFeed(BASE).fetchDaily();
    expect(days).toHaveLength(1);
    expect(days[0]!.ratesPerEur.get("USD")!.toFixed(4)).toBe("1.1535");
  });

  it("fetches the 90-day feed", async () => {
    server.use(http.get(`${BASE}/eurofxref-hist-90d.xml`, () => HttpResponse.xml(XML)));
    expect(await new EcbFxFeed(BASE).fetchRecent()).toHaveLength(1);
  });

  it("fetches the full-history feed", async () => {
    server.use(http.get(`${BASE}/eurofxref-hist.xml`, () => HttpResponse.xml(XML)));
    expect(await new EcbFxFeed(BASE).fetchFullHistory()).toHaveLength(1);
  });

  it("returns [] on a non-OK response rather than throwing", async () => {
    server.use(
      http.get(`${BASE}/eurofxref-daily.xml`, () => new HttpResponse(null, { status: 503 })),
    );
    expect(await new EcbFxFeed(BASE).fetchDaily()).toEqual([]);
  });

  it("returns [] when the network call rejects", async () => {
    server.use(http.get(`${BASE}/eurofxref-daily.xml`, () => HttpResponse.error()));
    expect(await new EcbFxFeed(BASE).fetchDaily()).toEqual([]);
  });

  it("gives up on a stalled response instead of hanging, and degrades to []", async () => {
    // A host that accepts the connection and then never answers: undici's
    // default headers timeout is 300 s, and one of these fetches is awaited
    // during boot. Without an AbortSignal this test never finishes.
    server.use(
      http.get(`${BASE}/eurofxref-daily.xml`, async () => {
        await delay("infinite");
        return HttpResponse.xml(XML);
      }),
    );
    const started = Date.now();
    expect(await new EcbFxFeed(BASE, 50).fetchDaily()).toEqual([]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("applies the timeout to the full-history feed too", async () => {
    server.use(
      http.get(`${BASE}/eurofxref-hist.xml`, async () => {
        await delay("infinite");
        return HttpResponse.xml(XML);
      }),
    );
    expect(await new EcbFxFeed(BASE, 50).fetchFullHistory()).toEqual([]);
  });
});
