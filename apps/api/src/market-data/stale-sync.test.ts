import { describe, it, expect } from "vitest";
import { pickStaleSymbols } from "./stale-sync";

const now = new Date("2026-07-03T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000);

describe("pickStaleSymbols", () => {
  it("puts never-synced symbols first, then oldest", () => {
    const last = new Map<string, Date | null>([
      ["AAPL", hoursAgo(30)],
      ["ORCHRD", null],
      ["O", hoursAgo(50)],
      ["FIZZCO", null],
    ]);
    expect(pickStaleSymbols(last, now)).toEqual(["ORCHRD", "FIZZCO", "O", "AAPL"]);
  });

  it("excludes symbols fresher than the TTL", () => {
    const last = new Map<string, Date | null>([
      ["AAPL", hoursAgo(2)],
      ["O", hoursAgo(25)],
    ]);
    expect(pickStaleSymbols(last, now)).toEqual(["O"]);
  });

  it("caps the result at the budget", () => {
    const last = new Map<string, Date | null>(
      ["A", "B", "C", "D", "E", "F", "G"].map((s) => [s, null]),
    );
    expect(pickStaleSymbols(last, now, 24, 5)).toHaveLength(5);
  });

  it("returns empty when everything is fresh", () => {
    const last = new Map<string, Date | null>([["AAPL", hoursAgo(1)]]);
    expect(pickStaleSymbols(last, now)).toEqual([]);
  });
});
