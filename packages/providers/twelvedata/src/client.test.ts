import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { delay, http, HttpResponse } from "msw";
import {
  ProviderAuthError,
  ProviderPlanLimitError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  SymbolNotFoundError,
} from "@sage/provider-interface";
import { TwelveDataClient } from "./client";
import {
  AAPL_QUOTE,
  ERROR_BAD_KEY,
  ERROR_DAILY_LIMIT,
  ERROR_ENDPOINT_PLAN,
  ERROR_INVALID_SYMBOL,
  ERROR_MINUTE_LIMIT,
  ERROR_NO_DATA,
  ERROR_SYMBOL_PLAN,
} from "./fixtures";

const BASE = "https://twelvedata.test";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** 2026-09-16 12:00:30 UTC — mid-minute, so window arithmetic is visible. */
const T0 = Date.UTC(2026, 8, 16, 12, 0, 30);

function clientAt(clock: { t: number }, creditsPerMinute = 8) {
  return new TwelveDataClient({
    apiKey: "test-key",
    baseUrl: BASE,
    creditsPerMinute,
    now: () => clock.t,
  });
}

function countCalls(path: string, respond: () => Response) {
  const seen = { calls: 0, urls: [] as string[], auth: [] as (string | null)[] };
  server.use(
    http.get(`${BASE}/${path}`, ({ request }) => {
      seen.calls += 1;
      seen.urls.push(request.url);
      seen.auth.push(request.headers.get("authorization"));
      return respond();
    }),
  );
  return seen;
}

describe("TwelveDataClient: the key", () => {
  it("sends the key as a header and never in the URL", async () => {
    const seen = countCalls("quote", () => HttpResponse.json(AAPL_QUOTE));
    const clock = { t: T0 };
    await clientAt(clock).request("quote", { symbol: "AAPL" });
    expect(seen.auth).toEqual(["apikey test-key"]);
    expect(seen.urls[0]).not.toContain("test-key");
    expect(seen.urls[0]).toContain("symbol=AAPL");
  });
});

describe("TwelveDataClient: classification", () => {
  it("maps a bad key to ProviderAuthError", async () => {
    countCalls("quote", () => HttpResponse.json(ERROR_BAD_KEY, { status: 401 }));
    await expect(clientAt({ t: T0 }).request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
  });

  it("reads an error envelope even when the HTTP status is 200", async () => {
    countCalls("quote", () => HttpResponse.json(ERROR_BAD_KEY));
    await expect(clientAt({ t: T0 }).request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
  });

  it("maps an endpoint the plan excludes to ProviderPlanLimitError", async () => {
    countCalls("dividends", () => HttpResponse.json(ERROR_ENDPOINT_PLAN, { status: 403 }));
    await expect(
      clientAt({ t: T0 }).request("dividends", { symbol: "VOO" }, { listingKey: "VOO" }),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
  });

  it("maps a listing the plan excludes to ProviderPlanLimitError", async () => {
    countCalls("quote", () => HttpResponse.json(ERROR_SYMBOL_PLAN, { status: 404 }));
    await expect(
      clientAt({ t: T0 }).request(
        "quote",
        { symbol: "EUDIV", mic_code: "XETR" },
        { listingKey: "EUDIV@XETR", notFoundSymbol: "EUDIV.DE" },
      ),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
  });

  it("maps an invalid symbol to SymbolNotFoundError carrying the app symbol", async () => {
    countCalls("quote", () => HttpResponse.json(ERROR_INVALID_SYMBOL, { status: 404 }));
    const err = await clientAt({ t: T0 })
      .request("quote", { symbol: "NOPE" }, { listingKey: "NOPE", notFoundSymbol: "NOPE" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SymbolNotFoundError);
    expect((err as SymbolNotFoundError).symbol).toBe("NOPE");
  });

  it("maps a 429 to ProviderRateLimitError", async () => {
    countCalls("quote", () => HttpResponse.json(ERROR_MINUTE_LIMIT, { status: 429 }));
    await expect(clientAt({ t: T0 }).request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
  });

  it("maps a server error, a network failure and non-JSON to ProviderUnavailableError", async () => {
    countCalls("quote", () => new HttpResponse(null, { status: 502 }));
    await expect(clientAt({ t: T0 }).request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    server.resetHandlers();
    countCalls("quote", () => HttpResponse.error());
    await expect(clientAt({ t: T0 }).request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    server.resetHandlers();
    countCalls("quote", () => HttpResponse.text("<html>"));
    await expect(clientAt({ t: T0 }).request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("gives up on a request that never answers, as ProviderUnavailableError", async () => {
    server.use(
      http.get(`${BASE}/quote`, async () => {
        await delay("infinite");
        return HttpResponse.json(AAPL_QUOTE);
      }),
    );
    const stalled = new TwelveDataClient({
      apiKey: "test-key",
      baseUrl: BASE,
      now: () => T0,
      timeoutMs: 20,
    });
    await expect(stalled.request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("resolves null for no data when the caller allows it, and otherwise refuses", async () => {
    countCalls("time_series", () => HttpResponse.json(ERROR_NO_DATA, { status: 400 }));
    await expect(
      clientAt({ t: T0 }).request("time_series", { symbol: "AAPL" }, { allowNoData: true }),
    ).resolves.toBeNull();
    await expect(
      clientAt({ t: T0 }).request("time_series", { symbol: "AAPL" }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

describe("TwelveDataClient: the per-minute budget", () => {
  it("never sends the request that would exceed the budget, and refills next minute", async () => {
    const seen = countCalls("quote", () => HttpResponse.json(AAPL_QUOTE));
    const clock = { t: T0 };
    const client = clientAt(clock, 2);
    await client.request("quote", { symbol: "AAPL" });
    await client.request("quote", { symbol: "AAPL" });
    await expect(client.request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderPlanLimitError,
    );
    expect(seen.calls).toBe(2);

    clock.t = Date.UTC(2026, 8, 16, 12, 1, 0);
    await client.request("quote", { symbol: "AAPL" });
    expect(seen.calls).toBe(3);
  });

  it("does not charge search, which costs no credits", async () => {
    const seen = countCalls("symbol_search", () => HttpResponse.json({ data: [] }));
    const client = clientAt({ t: T0 }, 1);
    for (let i = 0; i < 3; i++) await client.request("symbol_search", { symbol: "x" });
    expect(seen.calls).toBe(3);
  });

  it("gives back the credit an endpoint refusal did not use", async () => {
    // Measured 2026-09-17: a 403 "/dividends is available exclusively with…"
    // returns no credit headers and leaves the minute's count untouched.
    const dividends = countCalls("dividends", () =>
      HttpResponse.json(ERROR_ENDPOINT_PLAN, { status: 403 }),
    );
    const quotes = countCalls("quote", () => HttpResponse.json(AAPL_QUOTE));
    const client = clientAt({ t: T0 }, 1);
    await expect(
      client.request("dividends", { symbol: "VOO" }, { listingKey: "VOO" }),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
    await expect(
      client.request("quote", { symbol: "AAPL" }, { listingKey: "AAPL" }),
    ).resolves.toBeTruthy();
    expect([dividends.calls, quotes.calls]).toEqual([1, 1]);
  });

  it("keeps the credit a listing refusal spent, because Twelve Data charges it", async () => {
    // Measured 2026-09-17: a 404 "This symbol is available starting with the
    // Grow or Venture plan" moves api-credits-used by one, like a served quote.
    // Refunding it let a free key overrun its minute and draw a real 429.
    countCalls("quote", () => HttpResponse.json(ERROR_SYMBOL_PLAN, { status: 404 }));
    const client = clientAt({ t: T0 }, 1);
    await expect(
      client.request("quote", { symbol: "EUDIV", mic_code: "XETR" }, { listingKey: "EUDIV@XETR" }),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
    server.resetHandlers();
    const quotes = countCalls("quote", () => HttpResponse.json(AAPL_QUOTE));
    await expect(
      client.request("quote", { symbol: "AAPL" }, { listingKey: "AAPL" }),
    ).rejects.toThrow(/credit budget is spent/);
    expect(quotes.calls).toBe(0);
  });

  it("does not refund a credit into a window the charge was not made in", async () => {
    let resolveFirst: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    server.use(http.get(`${BASE}/dividends`, () => firstResponse));
    const quotes = countCalls("quote", () => HttpResponse.json(AAPL_QUOTE));
    // Mid the 12:00 window, one second before it rolls over.
    const clock = { t: Date.UTC(2026, 8, 16, 12, 0, 59) };
    const client = clientAt(clock, 8);

    // Charge request A in the 12:00 window; its response will not resolve yet.
    const pending = client.request("dividends", { symbol: "VOO" }, { listingKey: "VOO" });

    // The window rolls over before A's response arrives, and the new window's
    // whole budget is spent by other calls.
    clock.t = Date.UTC(2026, 8, 16, 12, 1, 0);
    for (let i = 0; i < 8; i++) {
      await client.request("quote", { symbol: "AAPL" });
    }
    expect(quotes.calls).toBe(8);

    // A now comes back as an endpoint refusal — the kind that IS refunded. It
    // was charged in the 12:00 window, which is long gone, so it must not
    // refund a credit into 12:01.
    resolveFirst!(HttpResponse.json(ERROR_ENDPOINT_PLAN, { status: 403 }));
    await expect(pending).rejects.toBeInstanceOf(ProviderPlanLimitError);

    // The 12:01 budget is still fully spent: the next call is refused locally,
    // with no network request.
    await expect(client.request("quote", { symbol: "KO" })).rejects.toBeInstanceOf(
      ProviderPlanLimitError,
    );
    expect(quotes.calls).toBe(8);
  });
});

describe("TwelveDataClient: remembering plan refusals", () => {
  it("stops asking for a refused endpoint for 24 hours", async () => {
    const seen = countCalls("dividends", () =>
      HttpResponse.json(ERROR_ENDPOINT_PLAN, { status: 403 }),
    );
    const clock = { t: T0 };
    const client = clientAt(clock);
    await expect(client.request("dividends", { symbol: "VOO" })).rejects.toBeInstanceOf(
      ProviderPlanLimitError,
    );
    await expect(client.request("dividends", { symbol: "KO" })).rejects.toBeInstanceOf(
      ProviderPlanLimitError,
    );
    expect(seen.calls).toBe(1);

    clock.t = T0 + 24 * 60 * 60 * 1000 + 1;
    await expect(client.request("dividends", { symbol: "KO" })).rejects.toBeInstanceOf(
      ProviderPlanLimitError,
    );
    expect(seen.calls).toBe(2);
  });

  it("blocks the endpoint for every symbol when a 403 refusal names that endpoint", async () => {
    const seen = countCalls("dividends", () =>
      HttpResponse.json(ERROR_ENDPOINT_PLAN, { status: 403 }),
    );
    const client = clientAt({ t: T0 });
    await expect(
      client.request("dividends", { symbol: "VOO" }, { listingKey: "VOO" }),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
    await expect(
      client.request("dividends", { symbol: "KO" }, { listingKey: "KO" }),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
    expect(seen.calls).toBe(1);
  });

  it("blocks only the listing when a 403 plan refusal does not name the endpoint", async () => {
    const seen = countCalls("quote", () =>
      HttpResponse.json({ ...ERROR_SYMBOL_PLAN, code: 403 }, { status: 403 }),
    );
    const client = clientAt({ t: T0 });
    await expect(
      client.request("quote", { symbol: "EUDIV" }, { listingKey: "EUDIV@XETR" }),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
    await expect(
      client.request("quote", { symbol: "EUDIV" }, { listingKey: "EUDIV@XETR" }),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
    expect(seen.calls).toBe(1);

    await expect(
      client.request("quote", { symbol: "THAMES" }, { listingKey: "THAMES@XLON" }),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
    expect(seen.calls).toBe(2);
  });

  it("remembers nothing when a 403 plan refusal names neither the endpoint nor a listing", async () => {
    const seen = countCalls("quote", () =>
      HttpResponse.json({ ...ERROR_SYMBOL_PLAN, code: 403 }, { status: 403 }),
    );
    const client = clientAt({ t: T0 });
    await expect(client.request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderPlanLimitError,
    );
    await expect(client.request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderPlanLimitError,
    );
    expect(seen.calls).toBe(2);
  });

  it("stops asking about a refused listing on any endpoint, and still asks about others", async () => {
    const quotes = countCalls("quote", () => HttpResponse.json(ERROR_SYMBOL_PLAN, { status: 404 }));
    const series = countCalls("time_series", () =>
      HttpResponse.json(ERROR_SYMBOL_PLAN, { status: 404 }),
    );
    const client = clientAt({ t: T0 });
    const listing = { listingKey: "EUDIV@XETR" };
    await expect(client.request("quote", { symbol: "EUDIV" }, listing)).rejects.toBeInstanceOf(
      ProviderPlanLimitError,
    );
    await expect(
      client.request("time_series", { symbol: "EUDIV" }, listing),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
    expect(quotes.calls).toBe(1);
    expect(series.calls).toBe(0);

    await expect(
      client.request("quote", { symbol: "THAMES" }, { listingKey: "THAMES@XLON" }),
    ).rejects.toBeInstanceOf(ProviderPlanLimitError);
    expect(quotes.calls).toBe(2);
  });
});

describe("TwelveDataClient: after a 429", () => {
  it("pauses every call until the next minute", async () => {
    const seen = countCalls("quote", () => HttpResponse.json(ERROR_MINUTE_LIMIT, { status: 429 }));
    const clock = { t: T0 };
    const client = clientAt(clock);
    await expect(client.request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
    await expect(client.request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
    expect(seen.calls).toBe(1);

    clock.t = Date.UTC(2026, 8, 16, 12, 1, 0);
    await expect(client.request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
    expect(seen.calls).toBe(2);
  });

  it("pauses until UTC midnight when the daily allowance is spent", async () => {
    const seen = countCalls("quote", () => HttpResponse.json(ERROR_DAILY_LIMIT, { status: 429 }));
    const clock = { t: T0 };
    const client = clientAt(clock);
    await expect(client.request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );

    clock.t = Date.UTC(2026, 8, 16, 23, 59, 59);
    await expect(client.request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
    expect(seen.calls).toBe(1);

    clock.t = Date.UTC(2026, 8, 17, 0, 0, 0);
    await expect(client.request("quote", { symbol: "AAPL" })).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
    expect(seen.calls).toBe(2);
  });
});
