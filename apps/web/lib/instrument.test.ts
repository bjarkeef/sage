import { describe, it, expect } from "vitest";
import { toSearchResult } from "./instrument";

describe("toSearchResult", () => {
  it("keeps a known asset type", () => {
    expect(
      toSearchResult({
        symbol: "VWCE",
        name: "Globix All-World",
        exchange: "XETR",
        currency: "EUR",
        assetType: "etf",
      }).assetType,
    ).toBe("etf");
  });

  it("falls back to other for an unrecognised type", () => {
    // AssetProfileDTO.assetType is a widened string; the API has shipped
    // values like "custom" and "cryptocurrency" that SearchResultDTO's union
    // does not carry. Passing one through unchecked is a type lie.
    expect(
      toSearchResult({
        symbol: "X",
        name: "X",
        exchange: "",
        currency: "USD",
        assetType: "cryptocurrency",
      }).assetType,
    ).toBe("other");
  });

  it("falls back to other when there is no type at all", () => {
    // PositionDTO carries no assetType. Safe: ensureInstrument only sets
    // assetType on insert, and a held instrument already exists.
    expect(
      toSearchResult({
        symbol: "AAPL",
        name: "Apple Inc",
        exchange: "XNAS",
        currency: "USD",
      }).assetType,
    ).toBe("other");
  });

  it("passes identity fields through untouched", () => {
    expect(
      toSearchResult({
        symbol: "AAPL",
        name: "Apple Inc",
        exchange: "XNAS",
        currency: "USD",
      }),
    ).toEqual({
      symbol: "AAPL",
      name: "Apple Inc",
      exchange: "XNAS",
      currency: "USD",
      assetType: "other",
    });
  });
});
