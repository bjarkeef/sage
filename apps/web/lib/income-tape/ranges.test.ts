import { describe, it, expect } from "vitest";
import { inViewRange, resolveRange, yearStepBounds } from "./ranges";
import { dayToIso, isoToDay } from "./points";

const today = isoToDay("2026-09-28");
const extent = { firstDay: isoToDay("2019-03-15"), lastDay: isoToDay("2029-12-31") };
const ctx = { todayDay: today, year: 2026, extent };
const iso = ([a, b]: [number, number]) => [dayToIso(a), dayToIso(b)];

describe("resolveRange", () => {
  it("Today shows a year either side and measures the headline", () => {
    const r = resolveRange("today", ctx);
    expect(r.label).toBe("Next 12 months");
    expect(iso(r.view)).toEqual(["2025-09-28", "2027-09-28"]);
    expect(iso(r.dates)).toEqual(["2026-09-28", "2027-09-28"]);
    expect(r.measure).toEqual({ kind: "headline", tag: "forward" });
    expect(r.compare).toEqual({ kind: "headline", tag: "trailing" });
    expect(r.compareLabel).toBe("last 12 months");
  });

  it("a year is that calendar year, compared with all of the one before", () => {
    const r = resolveRange("year", { ...ctx, year: 2025 });
    expect(r.label).toBe("2025");
    expect(iso(r.view)).toEqual(["2025-01-01", "2026-01-01"]);
    expect(r.measure).toEqual({
      kind: "window",
      from: isoToDay("2025-01-01"),
      to: isoToDay("2026-01-01"),
    });
    expect(r.compare).toEqual({
      kind: "window",
      from: isoToDay("2024-01-01"),
      to: isoToDay("2025-01-01"),
    });
    expect(r.compareLabel).toBe("all of 2024");
  });

  it("year to date runs through today, compared with the same span last year", () => {
    const r = resolveRange("ytd", ctx);
    expect(iso(r.dates)).toEqual(["2026-01-01", "2026-09-29"]);
    expect(r.compare).toEqual({
      kind: "window",
      from: isoToDay("2025-01-01"),
      to: isoToDay("2025-09-29"),
    });
    expect(r.compareLabel).toBe("same period in 2025");
  });

  it("all time spans the extent and has no comparison", () => {
    const r = resolveRange("all", ctx);
    expect(iso(r.view)).toEqual(["2019-03-15", "2030-01-01"]);
    expect(r.compare).toBeNull();
    expect(r.compareLabel).toBeNull();
  });
});

describe("inViewRange", () => {
  it("measures the window and compares it with a year earlier", () => {
    const r = inViewRange([1000, 1100]);
    expect(r.key).toBeNull();
    expect(r.label).toBe("In view");
    expect(r.measure).toEqual({ kind: "window", from: 1000, to: 1100 });
    expect(r.compare).toEqual({ kind: "window", from: 635, to: 735 });
    expect(r.compareLabel).toBe("same window a year earlier");
  });
});

describe("yearStepBounds", () => {
  it("runs from the first dividend's year to the last forecast year", () => {
    expect(yearStepBounds(extent)).toEqual({ min: 2019, max: 2029 });
  });
});
