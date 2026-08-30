import { describe, it, expect, vi } from "vitest";
import { CustomRoutingProvider } from "./custom-routing-provider";
import type { IMarketDataProvider } from "@sage/provider-interface";

/** Standalone vi.fn()s (not unbound methods) so assertions can reference them
 *  directly; `provider` is the same fns assembled into the interface shape. */
function stubProvider(label: string) {
  const getQuote = vi.fn().mockResolvedValue({ symbol: label });
  const getHistoricalPrices = vi.fn().mockResolvedValue([]);
  const getDividendHistory = vi.fn().mockResolvedValue([]);
  const searchSymbol = vi.fn().mockResolvedValue([{ symbol: label }]);
  const getAssetProfile = vi.fn().mockResolvedValue({ symbol: label });
  const provider = {
    getQuote,
    getHistoricalPrices,
    getDividendHistory,
    searchSymbol,
    getAssetProfile,
  } as unknown as IMarketDataProvider;
  return { provider, getQuote, searchSymbol, getHistoricalPrices };
}

/** db stub: only the query shape CustomRoutingProvider uses (select assetType
 *  from instrument where symbol=…). */
function stubDb(customSymbols: string[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ assetType: "custom" }]),
        }),
      }),
    }),
    __isCustom: (s: string) => customSymbols.includes(s),
  } as never;
}

describe("CustomRoutingProvider", () => {
  it("routes custom symbols to manual, others upstream — no fallthrough", async () => {
    const manual = stubProvider("manual");
    const upstream = stubProvider("upstream");
    const p = new CustomRoutingProvider(stubDb(["CASH_DKK"]), manual.provider, upstream.provider);
    // monkeypatch the lookup for a pure unit test
    (p as unknown as { isCustom: (s: string) => Promise<boolean> }).isCustom = (s) =>
      Promise.resolve(s === "CASH_DKK");

    await p.getQuote("CASH_DKK");
    expect(manual.getQuote).toHaveBeenCalledWith("CASH_DKK");
    expect(upstream.getQuote).not.toHaveBeenCalled();

    await p.getQuote("AAPL");
    expect(upstream.getQuote).toHaveBeenCalledWith("AAPL");
  });

  it("forwards history options to the upstream provider", async () => {
    const manual = stubProvider("manual");
    const upstream = stubProvider("upstream");
    const p = new CustomRoutingProvider(stubDb([]), manual.provider, upstream.provider);
    // monkeypatch the lookup for a pure unit test — same technique as the
    // routing test above.
    (p as unknown as { isCustom: (s: string) => Promise<boolean> }).isCustom = () =>
      Promise.resolve(false);

    const opts = { requireFrom: new Date("2024-01-01") };
    await p.getHistoricalPrices("AAPL", new Date("2024-01-01"), new Date("2024-06-01"), opts);

    expect(upstream.getHistoricalPrices).toHaveBeenCalledWith(
      "AAPL",
      new Date("2024-01-01"),
      new Date("2024-06-01"),
      opts,
    );
  });

  it("searchSymbol merges manual hits first, tolerates upstream failure", async () => {
    const manual = stubProvider("manual");
    const upstream = stubProvider("upstream");
    upstream.searchSymbol.mockRejectedValue(new Error("quota"));
    const p = new CustomRoutingProvider(stubDb([]), manual.provider, upstream.provider);
    const results = await p.searchSymbol("bank");
    expect(results).toEqual([{ symbol: "manual" }]);
  });
});
