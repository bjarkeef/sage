import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  SymbolNotFoundError,
} from "@sage/provider-interface";
import { EodhdClient } from "./client";

const BASE = "https://eodhd.test/api";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client() {
  return new EodhdClient({ apiToken: "test-token", baseUrl: BASE });
}

describe("EodhdClient.request", () => {
  it("sends api_token and fmt=json and returns parsed JSON", async () => {
    let seenUrl = "";
    server.use(
      http.get(`${BASE}/eod/AAPL.US`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    const body = await client().request("/eod/AAPL.US");
    expect(body).toEqual([]);
    expect(seenUrl).toContain("api_token=test-token");
    expect(seenUrl).toContain("fmt=json");
  });

  it("forwards additional params", async () => {
    let seenUrl = "";
    server.use(
      http.get(`${BASE}/eod/AAPL.US`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await client().request("/eod/AAPL.US", { params: { from: "2024-01-01" } });
    expect(seenUrl).toContain("from=2024-01-01");
  });

  it("maps 401 to ProviderAuthError", async () => {
    server.use(http.get(`${BASE}/eod/AAPL.US`, () => new HttpResponse(null, { status: 401 })));
    await expect(client().request("/eod/AAPL.US")).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it("maps 403 to ProviderAuthError", async () => {
    server.use(http.get(`${BASE}/eod/AAPL.US`, () => new HttpResponse(null, { status: 403 })));
    await expect(client().request("/eod/AAPL.US")).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it("maps 429 to ProviderRateLimitError", async () => {
    server.use(http.get(`${BASE}/eod/AAPL.US`, () => new HttpResponse(null, { status: 429 })));
    await expect(client().request("/eod/AAPL.US")).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it("maps 402 to ProviderRateLimitError", async () => {
    // EODHD signals an exhausted daily allowance with 402 Payment Required,
    // not 429. Without this it is indistinguishable from an outage.
    server.use(http.get(`${BASE}/eod/AAPL.US`, () => new HttpResponse(null, { status: 402 })));
    await expect(client().request("/eod/AAPL.US")).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it("maps 500 to ProviderUnavailableError", async () => {
    server.use(http.get(`${BASE}/eod/AAPL.US`, () => new HttpResponse(null, { status: 500 })));
    await expect(client().request("/eod/AAPL.US")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("maps malformed JSON to ProviderUnavailableError", async () => {
    server.use(
      http.get(
        `${BASE}/eod/AAPL.US`,
        () =>
          new HttpResponse("not json", {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(client().request("/eod/AAPL.US")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("maps a network failure to ProviderUnavailableError", async () => {
    server.use(http.get(`${BASE}/eod/AAPL.US`, () => HttpResponse.error()));
    await expect(client().request("/eod/AAPL.US")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("maps 404 to SymbolNotFoundError when a symbol is supplied", async () => {
    // A symbol outside EODHD's universe is the ordinary case
    // FallbackMarketDataProvider exists to handle, not an outage — it must not
    // be indistinguishable from a server failure (provider-health.ts).
    server.use(http.get(`${BASE}/eod/NOPE.US`, () => new HttpResponse(null, { status: 404 })));
    await expect(
      client().request("/eod/NOPE.US", { notFoundSymbol: "NOPE" }),
    ).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it("maps 404 to ProviderUnavailableError when no symbol is supplied", async () => {
    // searchSymbol is a free-text query, not a single-symbol lookup — a 404
    // there does not mean "this symbol does not exist".
    server.use(http.get(`${BASE}/search/foo`, () => new HttpResponse(null, { status: 404 })));
    await expect(client().request("/search/foo")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
