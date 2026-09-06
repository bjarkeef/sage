import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { formatSplitRatio } from "./split-ratio";

describe("formatSplitRatio", () => {
  // A reverse split stores a ratio below 1: ten old shares became one.
  it("renders a reverse split as old → new", () => {
    expect(formatSplitRatio(new Decimal("0.1"))).toEqual({
      ratio: "10 → 1",
      kind: "reverse-split",
    });
  });

  it("renders a forward split as 1 → new", () => {
    expect(formatSplitRatio(new Decimal("2"))).toEqual({ ratio: "1 → 2", kind: "split" });
  });

  // Rights issues and bonus issues arrive as splits with a fractional ratio.
  // Four decimals is enough to recognise the action without printing noise.
  it("trims a fractional ratio to four decimals", () => {
    expect(formatSplitRatio(new Decimal("1.34290551"))).toEqual({
      ratio: "1 → 1.3429",
      kind: "split",
    });
  });

  it("drops trailing zeros rather than printing 1 → 2.0000", () => {
    expect(formatSplitRatio(new Decimal("2.5000"))).toEqual({
      ratio: "1 → 2.5",
      kind: "split",
    });
  });

  // 0.3 inverts to 3.3333…, a ratio that does not divide cleanly and must
  // still render readably rather than as a repeating decimal.
  it("renders an untidy reverse ratio without a repeating decimal", () => {
    expect(formatSplitRatio(new Decimal("0.3"))).toEqual({
      ratio: "3.3333 → 1",
      kind: "reverse-split",
    });
  });

  // A ratio of exactly 1 changes nothing and must not claim a direction.
  it("treats a unit ratio as a forward split of 1 → 1", () => {
    expect(formatSplitRatio(new Decimal("1"))).toEqual({ ratio: "1 → 1", kind: "split" });
  });

  // 1/0.7 is 1.428571…, so the fifth decimal is 7 and the fourth must round up.
  // Truncation would render 1.4285 — this is the case that pins the rounding mode.
  it("rounds a reverse ratio up rather than truncating", () => {
    expect(formatSplitRatio(new Decimal("0.7"))).toEqual({
      ratio: "1.4286 → 1",
      kind: "reverse-split",
    });
  });

  // 1.23445 sits exactly halfway between 1.2344 and 1.2345 at four decimals,
  // and 1.2344 is already even, so ROUND_HALF_EVEN would leave it there while
  // ROUND_HALF_UP rounds away from zero to 1.2345 — this is the case that
  // actually pins HALF_UP against HALF_EVEN. (1.23455 does not: both modes
  // render it 1.2346, since HALF_EVEN's own tie-break lands on the even 6.)
  it("rounds a half at the fourth decimal up, not to even", () => {
    expect(formatSplitRatio(new Decimal("1.23445"))).toEqual({
      ratio: "1 → 1.2345",
      kind: "split",
    });
  });

  // formatSplitRatio assumes a positive ratio (see its JSDoc); callers filter
  // non-positive quantities before this point, the way split-basis.ts already
  // does for the same reason. This pins today's behavior for a ratio of zero —
  // decimal.js renders 1/0 as Infinity rather than throwing — so a later edit
  // cannot silently start returning something else for an input outside the
  // documented contract.
  it("locks current behavior for a non-positive ratio, which is out of contract", () => {
    expect(formatSplitRatio(new Decimal(0))).toEqual({
      ratio: "Infinity → 1",
      kind: "reverse-split",
    });
  });
});
