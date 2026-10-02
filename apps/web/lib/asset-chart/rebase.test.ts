import { describe, it, expect } from "vitest";
import { alignToDates, rebasePair } from "./rebase";

const holding = [
  { time: "2026-03-02", value: 100 },
  { time: "2026-03-03", value: 110 },
  { time: "2026-03-04", value: 99 },
];

describe("alignToDates", () => {
  it("carries the last known close forward and leaves days before the first bar empty", () => {
    expect(
      alignToDates(["2026-03-01", "2026-03-02", "2026-03-03"], [{ date: "2026-03-02", close: 5 }]),
    ).toEqual([null, 5, 5]);
  });
});

describe("rebasePair", () => {
  it("rebases both lines to percent change from the first shared day", () => {
    const r = rebasePair(holding, [
      { date: "2026-03-02", close: 200 },
      { date: "2026-03-03", close: 210 },
      { date: "2026-03-04", close: 220 },
    ])!;
    expect(r.holding.map((p) => p.time)).toEqual(["2026-03-02", "2026-03-03", "2026-03-04"]);
    expect(r.holding[0]!.value).toBe(0);
    expect(r.holding[1]!.value).toBeCloseTo(10, 10);
    expect(r.holding[2]!.value).toBeCloseTo(-1, 10);
    expect(r.benchmark[0]!.value).toBe(0);
    expect(r.benchmark[1]!.value).toBeCloseTo(5, 10);
    expect(r.benchmark[2]!.value).toBeCloseTo(10, 10);
  });

  it("carries the benchmark's close forward over a day it has no bar", () => {
    const r = rebasePair(holding, [
      { date: "2026-03-02", close: 200 },
      { date: "2026-03-04", close: 220 },
    ])!;
    expect(r.benchmark[0]!.value).toBe(0);
    expect(r.benchmark[1]!.value).toBe(0);
    expect(r.benchmark[2]!.value).toBeCloseTo(10, 10);
  });

  it("starts both lines at the benchmark's first bar when it begins later", () => {
    const r = rebasePair(holding, [
      { date: "2026-03-03", close: 210 },
      { date: "2026-03-04", close: 220 },
    ])!;
    expect(r.holding[0]).toEqual({ time: "2026-03-03", value: 0 });
    expect(r.holding[1]!.value).toBeCloseTo(-10, 10);
    expect(r.benchmark[1]!.value).toBeCloseTo((220 / 210 - 1) * 100, 10);
  });

  it("returns null when the benchmark has no bar on or before any of the holding's days", () => {
    expect(rebasePair(holding, [{ date: "2026-04-01", close: 50 }])).toBeNull();
  });
});
