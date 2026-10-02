import { describe, it, expect, vi } from "vitest";
import type { IChartApi } from "lightweight-charts";
import { DividendMarkers, type DividendMark } from "./dividend-markers";

function harness(
  marks: DividendMark[],
  opts: { coordinate?: number | null; resolves?: boolean } = {},
) {
  const coordinate = opts.coordinate === undefined ? 42 : opts.coordinate;
  const chart = {
    timeScale: () => ({ timeToCoordinate: vi.fn(() => coordinate) }),
  } as unknown as IChartApi;
  const arcs: number[][] = [];
  const fills: string[] = [];
  const ctx = {
    beginPath: vi.fn(),
    arc: vi.fn((x: number, y: number, r: number) => arcs.push([x, y, r])),
    fill: vi.fn(),
    set fillStyle(v: string) {
      fills.push(v);
    },
    get fillStyle() {
      return "";
    },
  };
  const target = {
    useBitmapCoordinateSpace: (fn: (scope: unknown) => void) =>
      fn({
        context: ctx,
        horizontalPixelRatio: 2,
        verticalPixelRatio: 2,
        mediaSize: { width: 600, height: 240 },
      }),
  };
  const markers = new DividendMarkers(
    chart,
    (t) => (opts.resolves === false ? undefined : t),
    () => marks,
    () => ({ dividend: "#e8cfa6", markerHalo: "#000000" }),
  );
  const draw = () =>
    (markers.paneViews()[0]!.renderer() as unknown as { draw: (t: unknown) => void }).draw(target);
  return { markers, draw, arcs, fills };
}

describe("DividendMarkers", () => {
  it("draws a paid-tone dot with a halo on the baseline at each ex-date", () => {
    const h = harness([{ time: "2026-05-13", id: "div-0" }]);
    h.draw();
    // Halo then dot, in bitmap pixels (×2), 7px above the pane's bottom edge.
    expect(h.arcs.map(([x, y]) => [x, y])).toEqual([
      [84, 466],
      [84, 466],
    ]);
    expect(h.fills).toEqual(["#000000", "#e8cfa6"]);
  });

  it("answers a hover near a dot with its id, and nothing away from it", () => {
    const h = harness([{ time: "2026-05-13", id: "div-0" }]);
    h.draw();
    expect(h.markers.hitTest(43, 232)?.externalId).toBe("div-0");
    expect(h.markers.hitTest(42, 100)).toBeNull();
  });

  it("draws nothing for a mark with no bar or off the visible scale", () => {
    const noBar = harness([{ time: "2026-05-13", id: "div-0" }], { resolves: false });
    noBar.draw();
    expect(noBar.arcs).toHaveLength(0);
    const offScale = harness([{ time: "2026-05-13", id: "div-0" }], { coordinate: null });
    offScale.draw();
    expect(offScale.arcs).toHaveLength(0);
  });
});
