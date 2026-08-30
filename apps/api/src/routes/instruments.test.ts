import { describe, it, expect, vi } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { SearchResult } from "@sage/provider-interface";
import { Money } from "@sage/core";
import { Hono } from "hono";
import type { Database } from "../db/client";
import type { AppEnv } from "../middleware/session";
import { instrumentsRoutes } from "./instruments";

vi.mock("../auth", () => ({
  getUserPortfolio: vi.fn(() => Promise.resolve({ id: "pf-test" })),
}));

const apple: SearchResult = {
  symbol: "AAPL",
  name: "Apple Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};

const customOwned: SearchResult = {
  symbol: "MYCASH",
  name: "My Cash",
  exchange: "CUSTOM",
  currency: "USD",
  assetType: "other",
};

const customOther: SearchResult = {
  symbol: "THEIRS",
  name: "Their Holding",
  exchange: "CUSTOM",
  currency: "USD",
  assetType: "other",
};

const appleQuote = {
  symbol: "AAPL",
  price: Money.of("150.25", "USD"),
  asOf: new Date("2026-07-15T00:00:00Z"),
  previousClose: null,
};

/** Minimal db: customHolding lookup returns owned symbols only. */
function fakeDb(ownedCustoms: string[] = []): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(ownedCustoms.map((symbol) => ({ symbol }))),
      }),
    }),
  } as unknown as Database;
}

function mount(provider: FakeMarketDataProvider, ownedCustoms: string[] = []) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("user", { id: "user-1" });
    c.set("session", {});
    await next();
  });
  app.route("/", instrumentsRoutes(fakeDb(ownedCustoms), provider));
  return app;
}

describe("GET /search", () => {
  it("returns provider search results", async () => {
    const provider = new FakeMarketDataProvider({ search: { apple: [apple] } });
    const res = await mount(provider).request("/search?q=apple");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([apple]);
  });

  it("filters custom symbols not owned by this portfolio", async () => {
    const provider = new FakeMarketDataProvider({
      search: { cash: [apple, customOwned, customOther] },
    });
    const res = await mount(provider, ["MYCASH"]).request("/search?q=cash");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([apple, customOwned]);
  });

  it("returns an empty array for a blank query without calling the provider", async () => {
    const provider = new FakeMarketDataProvider({ search: { "": [apple] } });
    const res = await mount(provider).request("/search?q=");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /:symbol/quote", () => {
  it("returns the current price and date", async () => {
    const provider = new FakeMarketDataProvider({ quotes: { AAPL: appleQuote } });
    const res = await mount(provider).request("/AAPL/quote");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      price: { amount: string; currency: string };
      asOf: string;
    };
    expect(body.price.currency).toBe("USD");
    expect(Number(body.price.amount)).toBe(150.25);
    expect(body.asOf).toBe("2026-07-15");
  });

  it("404s when the provider has no quote for the symbol", async () => {
    const provider = new FakeMarketDataProvider({});
    const res = await mount(provider).request("/AAPL/quote");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "quote_unavailable" });
  });
});
