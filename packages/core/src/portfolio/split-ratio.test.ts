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
      ratio: "1 → 1.7992",
      kind: "split",
    });
  });

  it("drops trailing zeros rather than printing 1 → 2.0000", () => {
    expect(formatSplitRatio(new Decimal("2.5000"))).toEqual({
      ratio: "1 → 2.5",
      kind: "split",
    });
  });

  // 1/0.125 is exactly 8; a reverse ratio that does not divide cleanly still
  // has to render something readable rather than 1 → 0.3333.
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
});
