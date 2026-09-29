import { describe, it, expect } from "vitest";
import { placeLabels } from "./labels";

const overlaps = (a: { x: number; width: number; top: number; height: number }, b: typeof a) =>
  a.x - a.width / 2 < b.x + b.width / 2 &&
  a.x + a.width / 2 > b.x - b.width / 2 &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

describe("placeLabels", () => {
  it("places above the bar when there is room", () => {
    const [l] = placeLabels([{ key: "a", x: 100, anchorTop: 300, lines: ["KO", "104"] }], 60);
    expect(l!.top + l!.height).toBeLessThanOrEqual(300);
  });

  it("stacks neighbours upward instead of overlapping, and never overlaps", () => {
    const placed = placeLabels(
      Array.from({ length: 5 }, (_, i) => ({
        key: String(i),
        x: 100 + i * 10,
        anchorTop: 300,
        lines: ["DUOMO.MI", "666"],
      })),
      60,
    );
    expect(placed.length).toBeGreaterThan(1);
    for (const a of placed) for (const b of placed) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it("drops a label that has no free slot below the ceiling", () => {
    expect(placeLabels([{ key: "a", x: 100, anchorTop: 70, lines: ["KO", "1"] }], 60)).toEqual([]);
  });
});
