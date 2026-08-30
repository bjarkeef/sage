import { describe, it, expect } from "vitest";
import { countryToRegion } from "./region-map";

describe("countryToRegion", () => {
  it("maps US to North America", () => {
    expect(countryToRegion("US")).toBe("North America");
  });

  it("maps DE to Europe", () => {
    expect(countryToRegion("DE")).toBe("Europe");
  });

  it("maps JP to Asia-Pacific", () => {
    expect(countryToRegion("JP")).toBe("Asia-Pacific");
  });

  it("returns Unknown for null", () => {
    expect(countryToRegion(null)).toBe("Unknown");
  });

  it("returns Other for unmapped country", () => {
    expect(countryToRegion("XX")).toBe("Other");
  });

  it("is case-insensitive", () => {
    expect(countryToRegion("us")).toBe("North America");
  });

  /** Added alongside the region fix. Until countries actually resolved, an
   *  unmapped code cost nothing because every holding was already `Unknown`.
   *  Now that they resolve, a European ETF domiciled in Luxembourg would have
   *  read "Other" — which looks like a classification, not a gap. */
  it.each([
    ["LU", "Europe"],
    ["GR", "Europe"],
    ["CZ", "Europe"],
    ["HU", "Europe"],
  ])("maps %s to %s", (iso, region) => {
    expect(countryToRegion(iso)).toBe(region);
  });
});
