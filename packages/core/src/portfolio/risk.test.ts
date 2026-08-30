import { describe, it, expect } from "vitest";
import { Decimal } from "../money/decimal";
import { returnsFromIndex, pairReturns, beta, MIN_PAIRED_DAYS_FOR_BETA } from "./risk";
import type { DailyReturn } from "./performance";

/** `n` consecutive UTC dates ending today. Relative by construction — a
 *  hardcoded window would start failing on its own once it aged out. */
export function recentDates(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function lvl(date: string, v: string) {
  return { date, value: new Decimal(v) };
}
function ret(date: string, v: string): DailyReturn {
  return { date, value: new Decimal(v) };
}

describe("returnsFromIndex", () => {
  it("converts index levels to daily returns", () => {
    const [d1, d2, d3] = recentDates(3);
    const r = returnsFromIndex([lvl(d1!, "1"), lvl(d2!, "1.1"), lvl(d3!, "1.21")]);
    expect(r).toHaveLength(2);
    expect(r[0]!.date).toBe(d2);
    expect(r[0]!.value.toFixed(4)).toBe("0.1000");
    expect(r[1]!.value.toFixed(4)).toBe("0.1000");
  });

  it("returns nothing for a series too short to have a period", () => {
    const [d1] = recentDates(1);
    expect(returnsFromIndex([lvl(d1!, "1")])).toEqual([]);
  });

  it("skips a pair whose base level is zero rather than dividing by it", () => {
    const [d1, d2, d3] = recentDates(3);
    const r = returnsFromIndex([lvl(d1!, "0"), lvl(d2!, "1"), lvl(d3!, "1.5")]);
    expect(r).toHaveLength(1);
    expect(r[0]!.date).toBe(d3);
    expect(r[0]!.value.toFixed(4)).toBe("0.5000");
  });
});

describe("pairReturns", () => {
  it("keeps only dates present in both series", () => {
    const [d1, d2, d3] = recentDates(3);
    // The portfolio priced d2 (a US market holiday); the benchmark had no bar.
    const paired = pairReturns(
      [ret(d1!, "0.01"), ret(d2!, "0.02"), ret(d3!, "0.03")],
      [ret(d1!, "0.005"), ret(d3!, "0.015")],
    );
    expect(paired).toHaveLength(2);
    expect(paired.map((p) => p.date)).toEqual([d1, d3]);
    expect(paired[1]!.portfolio.toFixed(3)).toBe("0.030");
    expect(paired[1]!.benchmark.toFixed(3)).toBe("0.015");
  });

  it("returns an empty array when the series never overlap", () => {
    const [d1, d2] = recentDates(2);
    expect(pairReturns([ret(d1!, "0.01")], [ret(d2!, "0.01")])).toEqual([]);
  });

  it("emits pairs in ascending date order regardless of input order", () => {
    const [d1, d2] = recentDates(2);
    const paired = pairReturns(
      [ret(d2!, "0.02"), ret(d1!, "0.01")],
      [ret(d1!, "0.005"), ret(d2!, "0.01")],
    );
    expect(paired.map((p) => p.date)).toEqual([d1, d2]);
  });
});

/** `n` paired days where the portfolio return is `factor` × the benchmark
 *  return, and the benchmark actually moves (alternating so its variance is
 *  non-zero). Callers pass `n` above the floor unless testing suppression. */
function pairs(n: number, factor: number) {
  const dates = recentDates(n);
  return dates.map((date, i) => {
    const b = i % 2 === 0 ? 0.01 : -0.006;
    return {
      date,
      portfolio: new Decimal(b * factor),
      benchmark: new Decimal(b),
    };
  });
}

describe("beta", () => {
  it("is 1 for a portfolio that tracks the benchmark exactly", () => {
    const b = beta(pairs(30, 1));
    expect(b).not.toBeNull();
    expect(Number(b!).toFixed(4)).toBe("1.0000");
  });

  it("is 2 for a portfolio that moves twice as hard as the benchmark", () => {
    const b = beta(pairs(30, 2));
    expect(Number(b!).toFixed(4)).toBe("2.0000");
  });

  it("is 0 for a portfolio that does not move at all", () => {
    const b = beta(pairs(30, 0));
    expect(Number(b!).toFixed(4)).toBe("0.0000");
  });

  it("is negative for a portfolio that moves against the benchmark", () => {
    const b = beta(pairs(30, -1));
    expect(Number(b!).toFixed(4)).toBe("-1.0000");
  });

  it("is null below the paired-day floor", () => {
    expect(beta(pairs(MIN_PAIRED_DAYS_FOR_BETA - 1, 1))).toBeNull();
  });

  it("is reported at exactly the floor", () => {
    expect(beta(pairs(MIN_PAIRED_DAYS_FOR_BETA, 1))).not.toBeNull();
  });

  it("is null when the benchmark never moved — undefined, not infinite", () => {
    const dates = recentDates(30);
    const flat = dates.map((date) => ({
      date,
      portfolio: new Decimal("0.01"),
      benchmark: new Decimal("0"),
    }));
    expect(beta(flat)).toBeNull();
  });

  it("pins the floor at 20 so a change is a deliberate edit, not a drift", () => {
    expect(MIN_PAIRED_DAYS_FOR_BETA).toBe(20);
  });
});
