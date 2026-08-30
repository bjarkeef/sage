import { describe, it, expect } from "vitest";
import { fundAwareSector } from "./dividend-income-view";

describe("fundAwareSector", () => {
  it("buckets ETFs and funds under 'Funds & ETFs' regardless of any sector", () => {
    expect(fundAwareSector("etf", null)).toBe("Funds & ETFs");
    expect(fundAwareSector("fund", "Financial Services")).toBe("Funds & ETFs");
  });

  it("uses a stock's own sector", () => {
    expect(fundAwareSector("stock", "Technology")).toBe("Technology");
  });

  it("falls back to 'Unknown' only for a stock with no profiled sector", () => {
    expect(fundAwareSector("stock", null)).toBe("Unknown");
    expect(fundAwareSector(undefined, null)).toBe("Unknown");
  });
});
