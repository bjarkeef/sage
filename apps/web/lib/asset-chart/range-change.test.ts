import { describe, it, expect } from "vitest";
import { direction, rangeChange, valueAtOrBefore, RANGE_PHRASE } from "./range-change";

const pts = [
  { time: "2026-01-02", value: 100 },
  { time: "2026-01-05", value: 90 },
  { time: "2026-01-06", value: 110 },
];

describe("rangeChange", () => {
  it("measures from the first point to the last", () => {
    expect(rangeChange(pts)).toEqual({ abs: 10, pct: 10 });
  });

  it("measures to a hovered day, snapping to the bar at or before it", () => {
    expect(rangeChange(pts, "2026-01-05")).toEqual({ abs: -10, pct: -10 });
    expect(rangeChange(pts, "2026-01-04")).toEqual({ abs: 0, pct: 0 });
  });

  it("has nothing to say before the first bar, with no points, or from a zero start", () => {
    expect(rangeChange(pts, "2025-12-31")).toBeNull();
    expect(rangeChange([])).toBeNull();
    expect(
      rangeChange([
        { time: "2026-01-02", value: 0 },
        { time: "2026-01-05", value: 5 },
      ]),
    ).toBeNull();
  });

  it("finds the bar at or before a day", () => {
    expect(valueAtOrBefore(pts, "2026-01-05")?.value).toBe(90);
    expect(valueAtOrBefore(pts, "2026-01-01")).toBeNull();
  });
});

describe("direction", () => {
  it("calls a move under 0.005% flat — rounding is not a direction", () => {
    expect(direction({ abs: 0.0001, pct: 0.004 })).toBe("flat");
    expect(direction({ abs: 0, pct: 0 })).toBe("flat");
    expect(direction(null)).toBe("flat");
  });

  it("signs everything else", () => {
    expect(direction({ abs: 1, pct: 0.01 })).toBe("up");
    expect(direction({ abs: -3.35, pct: -9.8 })).toBe("down");
  });
});

describe("RANGE_PHRASE", () => {
  it("names every range in words for the header readout", () => {
    expect(RANGE_PHRASE).toEqual({
      "1W": "past week",
      "1M": "past month",
      "3M": "past 3 months",
      YTD: "year to date",
      "1Y": "past year",
      ALL: "all time",
    });
  });
});
