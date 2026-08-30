// apps/api/src/lib/sector-labels.test.ts
import { describe, it, expect } from "vitest";
import { canonicalSectorLabel } from "./sector-labels";

describe("canonicalSectorLabel", () => {
  it("maps Yahoo fund sector keys to canonical labels", () => {
    expect(canonicalSectorLabel("realestate")).toBe("Real Estate");
    expect(canonicalSectorLabel("consumer_cyclical")).toBe("Consumer Cyclical");
    expect(canonicalSectorLabel("financial_services")).toBe("Financial Services");
    expect(canonicalSectorLabel("basic_materials")).toBe("Basic Materials");
  });

  it("passes canonical stock-profile sector labels through unchanged", () => {
    expect(canonicalSectorLabel("Technology")).toBe("Technology");
    expect(canonicalSectorLabel("Real Estate")).toBe("Real Estate");
    expect(canonicalSectorLabel("Communication Services")).toBe("Communication Services");
  });

  it("prettifies unknown keys instead of leaking snake_case", () => {
    expect(canonicalSectorLabel("frontier_markets")).toBe("Frontier Markets");
    expect(canonicalSectorLabel("widgets")).toBe("Widgets");
    // True title case: trailing characters are lowercased, not passed through.
    expect(canonicalSectorLabel("FRONTIER_MARKETS")).toBe("Frontier Markets");
  });
});
