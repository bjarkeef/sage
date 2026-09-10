import { describe, it, expect } from "vitest";
import { splitSignRuns, type BandPoint } from "./gain-band";

// Screen space: y grows DOWNWARD, so a point whose value line sits *above* its
// money-in line has the smaller yv. Every fixture below is written that way on
// purpose — a fixture that reasons in prices would pass while the drawing came
// out inverted.
const at = (x: number, yv: number, yi: number): BandPoint => ({ x, yv, yi });

describe("splitSignRuns", () => {
  it("keeps a book that never went under water as one gain run", () => {
    const runs = splitSignRuns([at(0, 50, 90), at(10, 40, 90), at(20, 30, 92)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.sign).toBe(1);
    expect(runs[0]!.points).toHaveLength(3);
  });

  it("keeps a book that never recovered as one loss run", () => {
    const runs = splitSignRuns([at(0, 90, 50), at(10, 95, 50), at(20, 99, 52)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.sign).toBe(-1);
  });

  it("splits at the crossing and gives both runs the same meeting point", () => {
    // Value falls through money in exactly midway between x=0 and x=10.
    const runs = splitSignRuns([at(0, 40, 60), at(10, 80, 60)]);
    expect(runs.map((r) => r.sign)).toEqual([1, -1]);
    const endOfFirst = runs[0]!.points[runs[0]!.points.length - 1]!;
    const startOfSecond = runs[1]!.points[0]!;
    expect(endOfFirst).toEqual(startOfSecond);
    expect(endOfFirst.x).toBeCloseTo(5, 6);
  });

  it("gives the band zero height at the crossing", () => {
    // The whole point of interpolating rather than snapping to the next sample:
    // at the meeting point the two series are the same line, so the polygon
    // closes to nothing and neither colour bleeds past it.
    const meet = splitSignRuns([at(0, 40, 60), at(10, 80, 60)])[0]!.points.at(-1)!;
    expect(meet.yv).toBeCloseTo(meet.yi, 9);
    expect(meet.yv).toBeCloseTo(60, 6);
  });

  it("handles a year that went under and came back as three runs", () => {
    const runs = splitSignRuns([
      at(0, 40, 60),
      at(10, 80, 60),
      at(20, 90, 60),
      at(30, 40, 60),
      at(40, 30, 60),
    ]);
    expect(runs.map((r) => r.sign)).toEqual([1, -1, 1]);
  });

  it("draws nothing from a single point, which has no width", () => {
    expect(splitSignRuns([at(0, 40, 60)])).toEqual([]);
    expect(splitSignRuns([])).toEqual([]);
  });

  it("treats an exact touch as gain rather than flipping twice", () => {
    // Value meets money in and pulls away upward again. A `>` test here would
    // emit two spurious crossings and a zero-width loss run between them.
    const runs = splitSignRuns([at(0, 40, 60), at(10, 60, 60), at(20, 40, 60)]);
    expect(runs.map((r) => r.sign)).toEqual([1]);
  });
});
