import type { PositionDTO } from "./types";

export interface PortfolioInsight {
  symbol: string;
  direction: "up" | "down";
  percent: number;
}

/** The `n` biggest movers by absolute daily change, largest first. Positions
 *  with a null or zero daily change are not movers and are excluded. The sort is
 *  stable, so genuine ties keep their input order. Does not mutate `positions`. */
export function topMovers(positions: PositionDTO[], n: number): PortfolioInsight[] {
  return positions
    .filter((p) => p.dailyChangePercent != null && p.dailyChangePercent !== 0)
    .sort((a, b) => Math.abs(b.dailyChangePercent!) - Math.abs(a.dailyChangePercent!))
    .slice(0, n)
    .map((p) => ({
      symbol: p.symbol,
      direction: p.dailyChangePercent! > 0 ? "up" : "down",
      percent: Math.abs(p.dailyChangePercent!),
    }));
}
