import { describe, expect, it } from "vitest";
import { topMovers } from "./insight";
import type { PositionDTO } from "./types";

function pos(symbol: string, dailyChangePercent: number | null): PositionDTO {
  return { symbol, dailyChangePercent } as PositionDTO;
}

describe("topMovers", () => {
  it("returns the top n by absolute move, largest first", () => {
    const result = topMovers([pos("AAPL", 1.2), pos("NORDA-B", -3.4), pos("O", 0.5)], 2);
    expect(result).toEqual([
      { symbol: "NORDA-B", direction: "down", percent: 3.4 },
      { symbol: "AAPL", direction: "up", percent: 1.2 },
    ]);
  });

  it("ignores null and zero changes", () => {
    const result = topMovers([pos("AAPL", null), pos("O", 0), pos("MSFT", 1.1)], 2);
    expect(result).toEqual([{ symbol: "MSFT", direction: "up", percent: 1.1 }]);
  });

  it("keeps input order for ties (stable)", () => {
    const result = topMovers([pos("A", 2), pos("B", -2), pos("C", 1)], 2);
    expect(result.map((m) => m.symbol)).toEqual(["A", "B"]);
  });

  it("caps at n even when more movers qualify", () => {
    const result = topMovers([pos("A", 5), pos("B", 4), pos("C", 3)], 2);
    expect(result.map((m) => m.symbol)).toEqual(["A", "B"]);
  });

  it("does not mutate the input array", () => {
    const input = [pos("A", 1), pos("B", 5)];
    const snapshot = input.map((p) => p.symbol);
    topMovers(input, 2);
    expect(input.map((p) => p.symbol)).toEqual(snapshot);
  });

  it("returns an empty array for an empty portfolio", () => {
    expect(topMovers([], 2)).toEqual([]);
  });
});
