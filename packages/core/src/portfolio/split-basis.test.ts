import { describe, it, expect } from "vitest";
import { Decimal } from "../money/decimal";
import { Money } from "../money/money";
import {
  resolveSplitBasis,
  SPLIT_FACTOR_TOLERANCE,
  type SplitBasisResolution,
} from "./split-basis";
import type { PositionTransaction } from "./positions";
import type { BasisFinding } from "./basis-check";

/** `n` days before today as a "YYYY-MM-DD" UTC key. Relative by construction —
 *  a hardcoded window would start failing on its own once it aged out. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function tx(
  symbol: string,
  type: PositionTransaction["type"],
  date: string,
  quantity: string,
): PositionTransaction {
  return {
    symbol,
    type,
    quantity: new Decimal(quantity),
    price: Money.of("1", "USD"),
    tradeDate: new Date(`${date}T00:00:00Z`),
  };
}

function finding(symbol: string, factor: string, samples = 2): BasisFinding {
  return {
    symbol,
    factor: new Decimal(factor),
    mismatched: samples,
    samples,
    firstDate: daysAgo(40),
    lastDate: daysAgo(30),
  };
}

describe("resolveSplitBasis", () => {
  it("takes the identity path when the book has no splits at all", () => {
    const r = resolveSplitBasis([tx("STEADY", "buy", daysAgo(40), "10")], [], new Map());
    expect(r.identity).toBe(true);
    expect(r.verdictOf("STEADY")).toBe("unadjusted");
    expect(Number(r.factorAt("STEADY", daysAgo(40)))).toBe(1);
    expect(r.unverified).toEqual([]);
  });

  it("scales by the trailing product for a reverse split whose factor matches", () => {
    // 1-for-10: p = 0.1 before the split, expected detected factor 10.
    const r = resolveSplitBasis(
      [tx("ULTRA", "buy", daysAgo(40), "100"), tx("ULTRA", "split", daysAgo(20), "0.1")],
      [finding("ULTRA", "10.08")],
      new Map([["ULTRA", 2]]),
    );
    expect(r.verdictOf("ULTRA")).toBe("adjusted");
    expect(Number(r.factorAt("ULTRA", daysAgo(30)))).toBeCloseTo(0.1, 10);
    expect(Number(r.factorAt("ULTRA", daysAgo(10)))).toBe(1);
  });

  it("scales by the trailing product for a forward split whose factor matches", () => {
    // 2:1: p = 2 before the split, expected detected factor 2.
    const r = resolveSplitBasis(
      [tx("DOUBLE", "buy", daysAgo(40), "10"), tx("DOUBLE", "split", daysAgo(20), "2")],
      [finding("DOUBLE", "2.02")],
      new Map([["DOUBLE", 2]]),
    );
    expect(r.verdictOf("DOUBLE")).toBe("adjusted");
    expect(Number(r.factorAt("DOUBLE", daysAgo(30)))).toBeCloseTo(2, 10);
  });

  it("compounds multiple splits", () => {
    const r = resolveSplitBasis(
      [
        tx("TWICE", "buy", daysAgo(60), "10"),
        tx("TWICE", "split", daysAgo(40), "2"),
        tx("TWICE", "split", daysAgo(20), "3"),
      ],
      [finding("TWICE", "6")],
      new Map([["TWICE", 2]]),
    );
    // Before both: 2 x 3 = 6. Between: 3. After: 1.
    expect(Number(r.factorAt("TWICE", daysAgo(50)))).toBeCloseTo(6, 10);
    expect(Number(r.factorAt("TWICE", daysAgo(30)))).toBeCloseTo(3, 10);
    expect(Number(r.factorAt("TWICE", daysAgo(10)))).toBe(1);
  });

  it("applies nothing on the split date itself, because the quantity already carries it", () => {
    const r = resolveSplitBasis(
      [tx("EDGE", "buy", daysAgo(40), "100"), tx("EDGE", "split", daysAgo(20), "0.1")],
      [finding("EDGE", "10")],
      new Map([["EDGE", 2]]),
    );
    expect(Number(r.factorAt("EDGE", daysAgo(20)))).toBe(1);
    expect(Number(r.factorAt("EDGE", daysAgo(21)))).toBeCloseTo(0.1, 10);
  });

  it("leaves a split symbol alone when its samples agree — the history is not adjusted", () => {
    const r = resolveSplitBasis(
      [tx("RAW", "buy", daysAgo(40), "10"), tx("RAW", "split", daysAgo(20), "1.8")],
      [], // checked and clean: no finding
      new Map([["RAW", 4]]),
    );
    expect(r.verdictOf("RAW")).toBe("unadjusted");
    expect(Number(r.factorAt("RAW", daysAgo(30)))).toBe(1);
  });

  it("keeps a mismatch the split cannot explain, and corrects nothing", () => {
    // A 100x minor-unit error on a symbol that also had a 2:1 split.
    const r = resolveSplitBasis(
      [tx("PENCE", "buy", daysAgo(40), "10"), tx("PENCE", "split", daysAgo(20), "2")],
      [finding("PENCE", "100")],
      new Map([["PENCE", 2]]),
    );
    expect(r.verdictOf("PENCE")).toBe("unadjusted");
    expect(Number(r.factorAt("PENCE", daysAgo(30)))).toBe(1);
  });

  it("reports a split it could not check rather than guessing", () => {
    const r = resolveSplitBasis(
      [tx("DARK", "buy", daysAgo(40), "10"), tx("DARK", "split", daysAgo(20), "2")],
      [],
      new Map(), // zero checked samples
    );
    expect(r.verdictOf("DARK")).toBe("unverified");
    expect(Number(r.factorAt("DARK", daysAgo(30)))).toBe(1);
    expect(r.unverified).toEqual(["DARK"]);
  });

  it("ignores a degenerate split ratio instead of erasing the holding's history", () => {
    const r = resolveSplitBasis(
      [tx("BADROW", "buy", daysAgo(40), "10"), tx("BADROW", "split", daysAgo(20), "0")],
      [],
      new Map([["BADROW", 2]]),
    );
    // Its only split row is unusable, so it is treated as having no splits.
    expect(r.verdictOf("BADROW")).toBe("unadjusted");
    expect(Number(r.factorAt("BADROW", daysAgo(30)))).toBe(1);
    expect(r.unverified).toEqual([]);
  });

  it("accepts a factor at the edge of the tolerance band and rejects one beyond it", () => {
    const inside = resolveSplitBasis(
      [tx("EDGY", "buy", daysAgo(40), "10"), tx("EDGY", "split", daysAgo(20), "2")],
      [finding("EDGY", String(2 * (1 + SPLIT_FACTOR_TOLERANCE * 0.9)))],
      new Map([["EDGY", 2]]),
    );
    expect(inside.verdictOf("EDGY")).toBe("adjusted");

    const outside = resolveSplitBasis(
      [tx("EDGY", "buy", daysAgo(40), "10"), tx("EDGY", "split", daysAgo(20), "2")],
      [finding("EDGY", String(2 * (1 + SPLIT_FACTOR_TOLERANCE * 1.5)))],
      new Map([["EDGY", 2]]),
    );
    expect(outside.verdictOf("EDGY")).toBe("unadjusted");
  });

  it("pins the tolerance at 0.15 so a change is a deliberate edit", () => {
    expect(SPLIT_FACTOR_TOLERANCE).toBe(0.15);
  });

  it("is a plain object satisfying the published contract", () => {
    const r: SplitBasisResolution = resolveSplitBasis([], [], new Map());
    expect(r.identity).toBe(true);
  });
});
