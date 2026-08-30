import { describe, it, expect } from "vitest";
import { Decimal } from "../money/decimal";
import { detectBasisMismatches, BASIS_MISMATCH_RATIO, type BasisSample } from "./basis-check";

/** `n` consecutive UTC dates ending today. Relative by construction — a
 *  hardcoded window would start failing on its own once it aged out. */
function recentDates(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function sample(date: string, symbol: string, transacted: string, close: string): BasisSample {
  return { date, symbol, transacted: new Decimal(transacted), close: new Decimal(close) };
}

describe("detectBasisMismatches", () => {
  it("catches a 2:1 split — the case a 5x threshold would have missed", () => {
    const [d] = recentDates(1);
    const f = detectBasisMismatches([sample(d!, "SPLITCO", "100", "50")]);
    expect(f).toHaveLength(1);
    expect(f[0]!.symbol).toBe("SPLITCO");
    expect(Number(f[0]!.factor).toFixed(2)).toBe("2.00");
  });

  it("ignores ordinary intraday divergence between a fill and the close", () => {
    const [d] = recentDates(1);
    expect(detectBasisMismatches([sample(d!, "STEADY", "100", "105")])).toEqual([]);
  });

  it("catches a minor-unit mismatch (GBX priced against GBP)", () => {
    const [d] = recentDates(1);
    const f = detectBasisMismatches([sample(d!, "PENCECO", "12.45", "1245")]);
    expect(Number(f[0]!.factor).toFixed(0)).toBe("100");
  });

  it("is symmetric — it does not care which side is larger", () => {
    const [d] = recentDates(1);
    const high = detectBasisMismatches([sample(d!, "A", "1000", "100")]);
    const low = detectBasisMismatches([sample(d!, "A", "100", "1000")]);
    expect(Number(high[0]!.factor)).toBeCloseTo(Number(low[0]!.factor), 6);
  });

  it("reports the median factor, so one outlier cannot move it", () => {
    const d = recentDates(4);
    const f = detectBasisMismatches([
      sample(d[0]!, "ULTRA", "5", "50"),
      sample(d[1]!, "ULTRA", "5", "50"),
      sample(d[2]!, "ULTRA", "5", "50"),
      sample(d[3]!, "ULTRA", "5", "200"),
    ]);
    expect(Number(f[0]!.factor).toFixed(2)).toBe("10.00");
  });

  it("reports both counts so a data-entry slip reads differently from a basis error", () => {
    const d = recentDates(5);
    const f = detectBasisMismatches([
      sample(d[0]!, "MIXED", "100", "100"),
      sample(d[1]!, "MIXED", "100", "101"),
      sample(d[2]!, "MIXED", "100", "99"),
      sample(d[3]!, "MIXED", "100", "102"),
      sample(d[4]!, "MIXED", "100", "1000"),
    ]);
    expect(f[0]!.mismatched).toBe(1);
    expect(f[0]!.samples).toBe(5);
  });

  it("emits nothing at all for a symbol whose samples agree", () => {
    const d = recentDates(2);
    expect(
      detectBasisMismatches([
        sample(d[0]!, "CLEAN", "10", "10"),
        sample(d[1]!, "CLEAN", "11", "11"),
      ]),
    ).toEqual([]);
  });

  it("dates the finding from the mismatched samples, not from all of them", () => {
    const d = recentDates(3);
    const f = detectBasisMismatches([
      sample(d[0]!, "LATE", "10", "10"),
      sample(d[1]!, "LATE", "10", "100"),
      sample(d[2]!, "LATE", "10", "100"),
    ]);
    expect(f[0]!.firstDate).toBe(d[1]);
    expect(f[0]!.lastDate).toBe(d[2]);
  });

  it("skips a zero on either side instead of reporting an infinite divergence", () => {
    const d = recentDates(2);
    const f = detectBasisMismatches([
      sample(d[0]!, "ZERO", "0", "50"),
      sample(d[1]!, "ZERO", "5", "50"),
    ]);
    // The zero sample is unchecked: one sample seen, one mismatched.
    expect(f[0]!.samples).toBe(1);
    expect(f[0]!.mismatched).toBe(1);
    expect(Number.isFinite(Number(f[0]!.factor))).toBe(true);
  });

  it("separates findings per symbol, ordered stably", () => {
    const d = recentDates(2);
    const f = detectBasisMismatches([
      sample(d[0]!, "ZEBRA", "1", "10"),
      sample(d[1]!, "ALPHA", "1", "10"),
    ]);
    expect(f.map((x) => x.symbol)).toEqual(["ALPHA", "ZEBRA"]);
  });

  it("pins the threshold at 1.5 so a change is a deliberate edit", () => {
    expect(BASIS_MISMATCH_RATIO).toBe(1.5);
  });
});
