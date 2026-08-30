import { describe, it, expect } from "vitest";
import { Decimal } from "../money/decimal";
import {
  computeDailyReturns,
  chainedTWR,
  annualize,
  growthIndex,
  xirr,
  volatility,
  maxDrawdown,
  bestWorstDay,
  type ValuationPoint,
  type DailyReturn,
} from "./performance";

function pt(date: string, mv: string, inv: string): ValuationPoint {
  return { date, marketValue: new Decimal(mv), invested: new Decimal(inv) };
}
function ret(date: string, v: string): DailyReturn {
  return { date, value: new Decimal(v) };
}

describe("computeDailyReturns", () => {
  it("computes a plain price return with no flows", () => {
    const { returns: r, anomalies } = computeDailyReturns([
      pt("2026-01-01", "100", "100"),
      pt("2026-01-02", "110", "100"),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.date).toBe("2026-01-02");
    expect(r[0]!.value.toFixed(4)).toBe("0.1000");
    expect(anomalies).toBe(0);
  });

  it("nets flowBasis rather than cost when a producer distinguishes them", () => {
    // A holding worth 5000 joins on day 2 having cost 500. Charged at cost the
    // day reads +450%; charged at market it reads 0, which is the truth — the
    // gain happened, but not inside this window.
    const { returns: r } = computeDailyReturns([
      {
        date: "2026-01-01",
        marketValue: new Decimal("1000"),
        invested: new Decimal("1000"),
        flowBasis: new Decimal("1000"),
      },
      {
        date: "2026-01-02",
        marketValue: new Decimal("6000"),
        invested: new Decimal("1500"),
        flowBasis: new Decimal("6000"),
      },
    ]);
    expect(r[0]!.value.toFixed(4)).toBe("0.0000");
  });

  it("falls back to invested when no flowBasis is supplied", () => {
    const { returns: r } = computeDailyReturns([
      pt("2026-01-01", "1000", "1000"),
      pt("2026-01-02", "1100", "1000"),
    ]);
    expect(r[0]!.value.toFixed(4)).toBe("0.1000");
  });

  it("is flow-neutral: a deposit does not change the return", () => {
    // price +10%, then a 50 deposit lands end-of-day: MV 160, invested 150
    const { returns: withDeposit } = computeDailyReturns([
      pt("2026-01-01", "100", "100"),
      pt("2026-01-02", "160", "150"),
    ]);
    expect(withDeposit[0]!.value.toFixed(4)).toBe("0.1000");
  });

  it("counts dividends as income on the fold-in date", () => {
    const { returns: r } = computeDailyReturns(
      [pt("2026-01-01", "100", "100"), pt("2026-01-02", "100", "100")],
      new Map([["2026-01-02", new Decimal(5)]]),
    );
    expect(r[0]!.value.toFixed(4)).toBe("0.0500");
  });

  it("folds a dividend on a non-valuation date into the next valuation date", () => {
    const { returns: r } = computeDailyReturns(
      [pt("2026-01-01", "100", "100"), pt("2026-01-05", "100", "100")],
      new Map([["2026-01-03", new Decimal(5)]]),
    );
    expect(r[0]!.value.toFixed(4)).toBe("0.0500");
  });

  it("ignores dividends dated at or before the anchor point", () => {
    const { returns: r } = computeDailyReturns(
      [pt("2026-01-01", "100", "100"), pt("2026-01-02", "100", "100")],
      new Map([["2026-01-01", new Decimal(5)]]),
    );
    expect(r[0]!.value.toFixed(4)).toBe("0.0000");
  });

  it("restarts the chain over a zero-value base without NaN", () => {
    // full exit at proceeds 100 (MV 0, invested 0), later re-entry at 50
    const { returns: r, anomalies } = computeDailyReturns([
      pt("2026-01-01", "100", "100"),
      pt("2026-01-02", "0", "0"),
      pt("2026-01-03", "50", "50"),
    ]);
    // pair 1→2: F = −100 (withdrawal), r = (0 + 100)/100 − 1 = 0
    // pair 2→3: base is 0 → skipped (not an anomaly)
    expect(r).toHaveLength(1);
    expect(r[0]!.value.toFixed(4)).toBe("0.0000");
    expect(anomalies).toBe(0);
    for (const x of r) expect(Number.isFinite(Number(x.value))).toBe(true);
  });

  it("returns [] for fewer than two points", () => {
    expect(computeDailyReturns([pt("2026-01-01", "100", "100")])).toEqual({
      returns: [],
      anomalies: 0,
    });
    expect(computeDailyReturns([])).toEqual({ returns: [], anomalies: 0 });
  });

  it("skips and counts a pair whose return is ≤ −1 (impossible long-only, a data artifact)", () => {
    // A poisoned MV/flow pair: MV 100 → 5 with a phantom flow of 200 gives
    // r = (5 − 200)/100 − 1 = −2.95 ≤ −1. It must never enter the chain.
    const { returns: r, anomalies } = computeDailyReturns([
      pt("2026-01-01", "100", "100"),
      pt("2026-01-02", "5", "300"),
    ]);
    expect(r).toHaveLength(0);
    expect(anomalies).toBe(1);
  });

  it("continues the chain after an anomalous pair", () => {
    // Day 2 is poisoned (r ≤ −1) but day 3 is a clean +10% off day 2's base.
    const { returns: r, anomalies } = computeDailyReturns([
      pt("2026-01-01", "100", "100"),
      pt("2026-01-02", "5", "300"), // anomaly: skipped
      pt("2026-01-03", "5.5", "300"), // clean: 5.5/5 − 1 = 0.10
    ]);
    expect(anomalies).toBe(1);
    expect(r).toHaveLength(1);
    expect(r[0]!.date).toBe("2026-01-03");
    expect(r[0]!.value.toFixed(4)).toBe("0.1000");
  });
});

describe("chainedTWR / growthIndex / annualize", () => {
  it("chains returns geometrically", () => {
    const twr = chainedTWR([ret("2026-01-02", "0.1"), ret("2026-01-03", "-0.05")]);
    expect(twr.toFixed(4)).toBe("0.0450"); // 1.1 × 0.95 − 1
  });

  it("growthIndex starts at 1 on the anchor and compounds", () => {
    const idx = growthIndex([ret("2026-01-02", "0.1"), ret("2026-01-03", "-0.05")], "2026-01-01");
    expect(idx.map((p) => p.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(idx.map((p) => p.value.toFixed(4))).toEqual(["1.0000", "1.1000", "1.0450"]);
  });

  it("annualizes: 21% over two years is 10% a year", () => {
    const a = annualize(new Decimal("0.21"), 730);
    expect(a).not.toBeNull();
    expect(Number(a!.minus("0.1").abs())).toBeLessThan(1e-9);
  });

  it("annualize returns null when the base is non-positive", () => {
    expect(annualize(new Decimal("-1"), 730)).toBeNull();
    expect(annualize(new Decimal("-1.5"), 730)).toBeNull();
  });
});

describe("TWR vs MWR divergence (the honest-measurement case)", () => {
  // Flat 6 months, then a 900 deposit, then a −20% crash over the next 6 months:
  // time-weighted −20%, but nearly all the money experienced the crash → MWR much worse.
  const points = [
    pt("2026-01-01", "100", "100"),
    pt("2026-06-30", "1000", "1000"),
    pt("2027-01-01", "800", "1000"),
  ];

  it("TWR is exactly the market's −20%", () => {
    const twr = chainedTWR(computeDailyReturns(points).returns);
    expect(twr.toFixed(4)).toBe("-0.2000");
  });

  it("XIRR is far below TWR", () => {
    const x = xirr([
      { date: "2026-01-01", amount: new Decimal(-100) },
      { date: "2026-06-30", amount: new Decimal(-900) },
      { date: "2027-01-01", amount: new Decimal(800) },
    ]);
    expect(x).not.toBeNull();
    const v = Number(x!);
    expect(v).toBeLessThan(-0.3);
    expect(v).toBeGreaterThan(-0.36);
  });
});

describe("xirr", () => {
  it("solves the textbook case exactly: −1000 → +1100 in one year = 10%", () => {
    const x = xirr([
      { date: "2026-01-01", amount: new Decimal(-1000) },
      { date: "2027-01-01", amount: new Decimal(1100) },
    ]);
    expect(x).not.toBeNull();
    expect(Number(x!.minus("0.1").abs())).toBeLessThan(1e-6);
  });

  it("returns null when there is no sign change", () => {
    expect(
      xirr([
        { date: "2026-01-01", amount: new Decimal(-100) },
        { date: "2027-01-01", amount: new Decimal(-100) },
      ]),
    ).toBeNull();
  });

  it("returns null for fewer than two flows", () => {
    expect(xirr([])).toBeNull();
    expect(xirr([{ date: "2026-01-01", amount: new Decimal(-100) }])).toBeNull();
  });
});

describe("risk stats", () => {
  const rs = [ret("2026-01-02", "0.01"), ret("2026-01-03", "-0.02"), ret("2026-01-04", "0.03")];

  it("volatility is the annualized sample stdev of daily returns", () => {
    expect(volatility(rs)!.toFixed(4)).toBe("0.3995");
  });

  it("volatility is null under two returns", () => {
    expect(volatility([])).toBeNull();
    expect(volatility([rs[0]!])).toBeNull();
  });

  it("maxDrawdown reads the peak-to-trough of the index", () => {
    const idx = ["1", "1.2", "0.9", "1.1", "1.05"].map((v, i) => ({
      date: `2026-01-0${i + 1}`,
      value: new Decimal(v),
    }));
    expect(maxDrawdown(idx).toFixed(4)).toBe("0.2500");
  });

  it("maxDrawdown is 0 for a monotonic rise or empty index", () => {
    const idx = ["1", "1.1", "1.2"].map((v, i) => ({
      date: `2026-01-0${i + 1}`,
      value: new Decimal(v),
    }));
    expect(maxDrawdown(idx).toFixed(4)).toBe("0.0000");
    expect(maxDrawdown([]).toFixed(4)).toBe("0.0000");
  });

  it("bestWorstDay picks extremes with their dates", () => {
    const bw = bestWorstDay(rs)!;
    expect(bw.best.date).toBe("2026-01-04");
    expect(bw.best.value.toFixed(2)).toBe("0.03");
    expect(bw.worst.date).toBe("2026-01-03");
    expect(bw.worst.value.toFixed(2)).toBe("-0.02");
    expect(bestWorstDay([])).toBeNull();
  });
});
