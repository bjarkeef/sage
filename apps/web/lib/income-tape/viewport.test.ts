import { describe, it, expect } from "vitest";
import { EDGE_PX, MAX_PX_PER_DAY, clampView, extentOf, fitView, windowOf } from "./viewport";

const W = 1096; // clear width 1000

describe("fitView / windowOf", () => {
  it("fits a range exactly into the clear area between the fades", () => {
    const v = fitView(100, 600, W);
    expect(v.pxPerDay).toBeCloseTo(2);
    expect(v.leftDay).toBeCloseTo(100 - EDGE_PX / 2);
    const [a, b] = windowOf(v, W);
    expect(a).toBeCloseTo(100);
    expect(b).toBeCloseTo(600);
  });
});

describe("clampView", () => {
  const extent = { firstDay: 0, lastDay: 1000 };

  it("never zooms out past the whole history", () => {
    const v = clampView({ leftDay: 0, pxPerDay: 0.1 }, W, extent);
    expect(v.pxPerDay).toBeCloseTo(1);
  });

  it("never zooms in past the ceiling", () => {
    expect(clampView({ leftDay: 500, pxPerDay: 50 }, W, extent).pxPerDay).toBe(MAX_PX_PER_DAY);
  });

  it("stops at both ends with the first and last day in the clear area", () => {
    const left = clampView({ leftDay: -500, pxPerDay: 2 }, W, extent);
    expect(windowOf(left, W)[0]).toBeCloseTo(0);
    const right = clampView({ leftDay: 5000, pxPerDay: 2 }, W, extent);
    expect(windowOf(right, W)[1]).toBeCloseTo(1000);
  });
});

describe("extentOf", () => {
  it("spans the points and always includes today", () => {
    const pts = [{ day: 10 }, { day: 50 }] as never[];
    expect(extentOf(pts, 5)).toEqual({ firstDay: 5, lastDay: 50 });
    expect(extentOf(pts, 80)).toEqual({ firstDay: 10, lastDay: 80 });
    expect(extentOf([], 80)).toEqual({ firstDay: 80 - 365, lastDay: 80 + 365 });
  });
});
