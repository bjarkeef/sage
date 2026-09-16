import { describe, it, expect } from "vitest";
import { ProviderPlanLimitError } from "@sage/provider-interface";
import { TwelveDataProvider } from "./provider";

/**
 * Talks to the REAL Twelve Data with TWELVEDATA_API_KEY from the environment.
 * Never part of `pnpm test`. Run it with:
 *
 *   TWELVEDATA_API_KEY=… pnpm --filter @sage/provider-twelvedata test:live
 *
 * Written against a free key: US prices must work, and anything the free plan
 * excludes must surface as ProviderPlanLimitError — the class that keeps the
 * degraded-prices banner off and hands the request to Yahoo. On a paid key the
 * two plan assertions are skipped by the `plan` guard below.
 */
const apiKey = process.env.TWELVEDATA_API_KEY;
const freePlan = (process.env.TWELVEDATA_PLAN ?? "free") === "free";

describe.skipIf(!apiKey)("Twelve Data (live)", () => {
  // A generous budget: this suite makes five calls and must not trip itself.
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
