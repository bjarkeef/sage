// @vitest-environment jsdom
// These exercise the browser branch, which keys off `typeof window`.
import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch, createTransaction } from "./api";

afterEach(() => vi.unstubAllGlobals());

const AAPL = {
  symbol: "AAPL",
  name: "Apple Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock" as const,
};

function failWith(body: unknown, status = 400) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("createTransaction error reporting", () => {
  const input = {
    instrument: AAPL,
    type: "buy" as const,
    quantity: "1",
    price: "100",
    tradeDate: "2026-01-01",
  };

  it("names both currencies when the ledger disagrees", async () => {
    // The bug this guards: every failure collapsed into "Could not save the
    // transaction.", discarding an API response that said exactly what was
    // wrong. A user hitting this saw a dead end, and diagnosing it took a
    // trip to the database.
    failWith({ error: "currency_mismatch", symbol: "AAPL", expected: "DKK", got: "USD" });
    await expect(createTransaction(input)).rejects.toThrow(
      "AAPL is bought and sold in DKK, but this transaction is in USD. Buys and sells " +
        "have to share one currency; dividends can settle in another.",
    );
  });

  it("still explains an oversell", async () => {
    failWith({ error: "oversell" });
    await expect(createTransaction(input)).rejects.toThrow("That sell exceeds your holdings.");
  });

  it("falls back to a generic message when the API says nothing useful", async () => {
    failWith({}, 500);
    await expect(createTransaction(input)).rejects.toThrow("Could not save the transaction.");
  });
});

describe("apiFetch (browser branch)", () => {
  it("uses the client base URL and includes credentials", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    await apiFetch("/dashboard");
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit | undefined];
    expect(String(url)).toContain("/dashboard");
    expect(init).toMatchObject({ credentials: "include" });
  });
});
