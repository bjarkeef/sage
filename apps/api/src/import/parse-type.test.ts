import { describe, it, expect } from "vitest";
import { resolveType, normalizeTypeValue, describeTypeFailure } from "./parse-type";

describe("resolveType", () => {
  it("resolves the plain words", () => {
    expect(resolveType("buy")).toEqual({ ok: true, type: "buy" });
    expect(resolveType("SELL")).toEqual({ ok: true, type: "sell" });
    expect(resolveType(" Dividend ")).toEqual({ ok: true, type: "dividend" });
    expect(resolveType("split")).toEqual({ ok: true, type: "split" });
  });

  it("resolves real broker phrasings", () => {
    // The values that made a Schwab-shaped export import zero rows.
    expect(resolveType("Cash Dividend")).toEqual({ ok: true, type: "dividend" });
    expect(resolveType("Qualified Dividend")).toEqual({ ok: true, type: "dividend" });
    expect(resolveType("Buy Trade")).toEqual({ ok: true, type: "buy" });
    expect(resolveType("SELL - MARKET")).toEqual({ ok: true, type: "sell" });
    expect(resolveType("Stock Split")).toEqual({ ok: true, type: "split" });
    expect(resolveType("Sell to Open")).toEqual({ ok: true, type: "sell" });
  });

  it("does not match an alias inside a longer word", () => {
    // "b" must not swallow every value that happens to contain the letter.
    expect(resolveType("rebalance")).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("reports values it cannot place rather than guessing", () => {
    // A DRIP row is a purchase at one broker and the income line at another;
    // guessing wrong either double counts or loses a position.
    expect(resolveType("Reinvest Shares")).toMatchObject({ ok: false, reason: "unknown" });
    expect(resolveType("Journal")).toMatchObject({ ok: false, reason: "unknown" });
    expect(resolveType("")).toMatchObject({ ok: false, reason: "empty" });
  });

  it("reports a value that matches two types as ambiguous", () => {
    const r = resolveType("Sell dividend rights");
    expect(r).toMatchObject({ ok: false, reason: "ambiguous" });
    if (!r.ok && r.reason === "ambiguous") {
      expect(r.matches.sort()).toEqual(["dividend", "sell"]);
    }
  });

  it("lets a user override beat the alias table", () => {
    const overrides = { "reinvest shares": "buy" as const };
    expect(resolveType("Reinvest Shares", overrides)).toEqual({ ok: true, type: "buy" });
    // Including a value the table would otherwise resolve differently.
    expect(resolveType("Cash Dividend", { "cash dividend": "buy" })).toEqual({
      ok: true,
      type: "buy",
    });
  });
});

describe("normalizeTypeValue", () => {
  it("collapses punctuation and case", () => {
    expect(normalizeTypeValue("SELL - MARKET")).toBe("sell market");
    expect(normalizeTypeValue("  Cash  Dividend ")).toBe("cash dividend");
  });
});

describe("describeTypeFailure", () => {
  it("points an unknown value at the control that fixes it", () => {
    const msg = describeTypeFailure({ ok: false, reason: "unknown", value: "journal" });
    expect(msg).toContain("journal");
    expect(msg).toContain("map it");
  });
});
