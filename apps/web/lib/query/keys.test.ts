import { describe, it, expect } from "vitest";
import { qk } from "./keys";

describe("query keys", () => {
  it("normalizes optional currency to null so undefined and unset match", () => {
    expect(qk.dashboard()).toEqual(["dashboard", null]);
    expect(qk.dashboard(undefined)).toEqual(["dashboard", null]);
    expect(qk.dashboard("EUR")).toEqual(["dashboard", "EUR"]);
  });

  it("keys variants independently", () => {
    expect(qk.performance("1Y")).toEqual(["performance", "1Y"]);
    expect(qk.assetDetail("AAPL")).toEqual(["asset-detail", "AAPL"]);
    expect(qk.portfolio()).toEqual(["portfolio"]);
    expect(qk.goal()).toEqual(["goal"]);
  });
});
