import { describe, it, expect } from "vitest";
import { ProviderPlanLimitError } from "@sage/provider-interface";
import { TwelveDataProvider } from "./provider";

/**
 * Talks to the REAL Twelve Data with TWELVEDATA_API_KEY from the environment.
 * Never part of `pnpm test`. Run it with:
 *
 *   TWELVEDATA_API_KEY=… pnpm --filter @sage/provider-twelvedata test:live
 *
 * On a paid key, also set TWELVEDATA_PLAN to anything other than `free` (e.g.
 * `TWELVEDATA_PLAN=grow`); it defaults to `free`.
 *
 * Written against a free key: US prices must work, and anything the free plan
 * excludes must surface as ProviderPlanLimitError — the class that keeps the
 * degraded-prices banner off and hands the request to Yahoo. When
 * TWELVEDATA_PLAN is not `free`, the two free-plan assertions are skipped (the
 * `freePlan` guard below), since a paid plan serves those requests.
 */
const apiKey = process.env.TWELVEDATA_API_KEY;
const freePlan = (process.env.TWELVEDATA_PLAN ?? "free") === "free";

describe.skipIf(!apiKey)("Twelve Data (live)", () => {
  // The free plan's per-minute cap, the smallest any key has. This suite makes
  // five calls (search is free), so it fits under that cap without tripping its
  // own budget guard.
  const provider = new TwelveDataProvider({ apiKey: apiKey ?? "", creditsPerMinute: 8 });

  it("returns a US quote", async () => {
    const quote = await provider.getQuote("AAPL");
    expect(quote.symbol).toBe("AAPL");
    expect(quote.price.currency).toBe("USD");
    expect(Number(quote.price.toDecimal().toFixed())).toBeGreaterThan(0);
  });

  it("returns a month of daily bars, oldest first", async () => {
    const to = new Date();
    const from = new Date(Date.now() - 31 * 86_400_000);
    const bars = await provider.getHistoricalPrices("AAPL", from, to);
    expect(bars.length).toBeGreaterThan(15);
    expect(bars[0]!.date.getTime()).toBeLessThan(bars.at(-1)!.date.getTime());
  });

  it("finds a listing by name", async () => {
    const results = await provider.searchSymbol("Apple");
    expect(results.some((r) => r.symbol === "AAPL")).toBe(true);
  });

  it.skipIf(!freePlan)("declines a German listing on the free plan as a plan limit", async () => {
    await expect(provider.getQuote("SAP.DE")).rejects.toBeInstanceOf(ProviderPlanLimitError);
  });

  it.skipIf(!freePlan)("declines ETF dividends on the free plan as a plan limit", async () => {
    await expect(provider.getDividendHistory("VOO")).rejects.toBeInstanceOf(ProviderPlanLimitError);
  });
});
