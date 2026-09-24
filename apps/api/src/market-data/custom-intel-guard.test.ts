import { describe, it, expect, vi } from "vitest";
import { SymbolNotFoundError, ProviderError } from "@sage/provider-interface";
import type { INewsProvider, IAnalystRatingsProvider } from "@sage/provider-interface";
import { CustomIntelGuard } from "./custom-intel-guard";

function stubUpstream() {
  const getNews = vi.fn().mockResolvedValue([{ title: "upstream" }]);
  const getAnalystRatings = vi.fn().mockResolvedValue({ analystCount: 3 });
  const provider = { getNews, getAnalystRatings } as unknown as INewsProvider &
    IAnalystRatingsProvider;
  return { provider, getNews, getAnalystRatings };
}

/** Pure unit test: the custom-symbol lookup is injected, not queried. */
function guard(upstream: INewsProvider & IAnalystRatingsProvider, custom: string[] = []) {
  return new CustomIntelGuard((s) => Promise.resolve(custom.includes(s)), upstream);
}

describe("CustomIntelGuard", () => {
  it("never asks upstream about a custom holding", async () => {
    const up = stubUpstream();
    const g = guard(up.provider, ["CASH_DKK"]);

    expect(await g.getNews("CASH_DKK")).toEqual([]);
    expect(await g.getAnalystRatings("CASH_DKK")).toBeNull();
    expect(up.getNews).not.toHaveBeenCalled();
    expect(up.getAnalystRatings).not.toHaveBeenCalled();
  });

  it("passes a market symbol through", async () => {
    const up = stubUpstream();
    const g = guard(up.provider, ["CASH_DKK"]);

    expect(await g.getNews("AAPL")).toEqual([{ title: "upstream" }]);
    expect(await g.getAnalystRatings("AAPL")).toEqual({ analystCount: 3 });
  });

  it("reads an unknown symbol as no coverage, not a failure", async () => {
    const up = stubUpstream();
    up.getNews.mockRejectedValue(new SymbolNotFoundError("NOPE"));
    up.getAnalystRatings.mockRejectedValue(new SymbolNotFoundError("NOPE"));
    const g = guard(up.provider);

    expect(await g.getNews("NOPE")).toEqual([]);
    expect(await g.getAnalystRatings("NOPE")).toBeNull();
  });

  // A transient outage must stay an error: caching it as "no coverage" would
  // hide ratings for a day.
  it("still throws other provider errors", async () => {
    const up = stubUpstream();
    up.getAnalystRatings.mockRejectedValue(new ProviderError("rate limited"));
    const g = guard(up.provider);

    await expect(g.getAnalystRatings("AAPL")).rejects.toThrow("rate limited");
  });
});
