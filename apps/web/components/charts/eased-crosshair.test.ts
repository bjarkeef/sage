import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SeriesAttachedParameter, Time } from "lightweight-charts";
import { CROSSHAIR_TAU_MS, EasedCrosshair, easeStep } from "./eased-crosshair";

const colors = () => ({ line: "#888888", dot: "#3dbe86", halo: "#000000" });
const attach = (c: EasedCrosshair, requestUpdate = vi.fn()) =>
  c.attached({ requestUpdate } as unknown as SeriesAttachedParameter<Time>);

describe("easeStep", () => {
  it("eases with a ~120ms time constant: 63% of the way after one", () => {
    expect(CROSSHAIR_TAU_MS).toBe(120);
    expect(easeStep(0, 100, CROSSHAIR_TAU_MS)).toBeCloseTo(100 * (1 - Math.exp(-1)), 6);
  });

  it("does not move without elapsed time, and snaps the last quarter pixel", () => {
    expect(easeStep(10, 100, 0)).toBe(10);
    expect(easeStep(99.9, 100, 1)).toBe(100);
  });
});

describe("EasedCrosshair", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("appears where the pointer first lands rather than easing in from nowhere", () => {
    const c = new EasedCrosshair(colors, () => false);
    attach(c);
    c.setTarget({ x: 50, y: 20 });
    expect(c.position).toEqual({ x: 50, y: 20 });
    expect(frames).toHaveLength(0);
  });

  it("eases toward a new target frame by frame, asking the chart to redraw", () => {
    const requestUpdate = vi.fn();
    const c = new EasedCrosshair(colors, () => false);
    attach(c, requestUpdate);
    vi.spyOn(performance, "now").mockReturnValue(1000);
    c.setTarget({ x: 0, y: 0 });
    c.setTarget({ x: 100, y: 0 });
    frames.shift()!(1000 + CROSSHAIR_TAU_MS);
    expect(c.position!.x).toBeCloseTo(100 * (1 - Math.exp(-1)), 6);
    expect(requestUpdate).toHaveBeenCalled();
    expect(frames).toHaveLength(1); // still travelling
  });

  it("jumps straight to the target under reduced motion", () => {
    const c = new EasedCrosshair(colors, () => true);
    attach(c);
    c.setTarget({ x: 0, y: 0 });
    c.setTarget({ x: 100, y: 40 });
    expect(c.position).toEqual({ x: 100, y: 40 });
    expect(frames).toHaveLength(0);
  });

  it("disappears when the pointer leaves the chart", () => {
    const c = new EasedCrosshair(colors, () => false);
    attach(c);
    c.setTarget({ x: 1, y: 1 });
    c.setTarget(null);
    expect(c.position).toBeNull();
  });
});
