import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  PrimitiveHoveredItem,
  PrimitivePaneViewZOrder,
} from "lightweight-charts";

/** The slice of fancy-canvas's bitmap scope this primitive uses — declared
 *  locally for the same reason as in `trade-markers.ts`. */
interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}
interface RenderTarget {
  useBitmapCoordinateSpace(fn: (scope: BitmapScope) => void): void;
}

export interface DividendMark {
  /** The ex-date. */
  time: string;
  /** Resolved back to the dividend by the hover label. */
  id: string;
}

export interface DividendMarkerTheme {
  dividend: string;
  markerHalo: string;
}

const RADIUS = 3.5;
const HALO_PAD = 1.5;
/** Distance of the dots above the pane's bottom edge, CSS px. */
const BASELINE_INSET = 7;
const HIT_RADIUS = 8;

/**
 * A dot on the chart's baseline at each ex-date in range, in the paid tone of
 * the certainty ramp. On the baseline rather than the line: a dividend is an
 * event in time, not a price, and the line already carries the trade triangles.
 */
export class DividendMarkers implements ISeriesPrimitive {
  private placed: { x: number; y: number; id: string }[] = [];

  constructor(
    private readonly chart: IChartApi,
    /** Snaps an ex-date to the bar it is booked on (the first bar on or after
     *  it); undefined when there is none in range. */
    private readonly resolve: (time: string) => string | undefined,
    private readonly getMarks: () => DividendMark[],
    private readonly getTheme: () => DividendMarkerTheme,
  ) {}

  paneViews(): IPrimitivePaneView[] {
    return [
      {
        zOrder: (): PrimitivePaneViewZOrder => "top",
        renderer: (): IPrimitivePaneRenderer => ({
          draw: (target: RenderTarget) => this.draw(target),
        }),
      },
    ];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    let best: { d: number; id: string } | null = null;
    for (const p of this.placed) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= HIT_RADIUS && (best === null || d < best.d)) best = { d, id: p.id };
    }
    if (!best) return null;
    return {
      externalId: best.id,
      zOrder: "top",
      distance: best.d,
      hitTestPriority: 2,
      cursorStyle: "pointer",
    };
  }

  private draw(target: RenderTarget) {
    const marks = this.getMarks();
    this.placed = [];
    if (marks.length === 0) return;
    const theme = this.getTheme();
    const timeScale = this.chart.timeScale();

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const y = scope.mediaSize.height - BASELINE_INSET;
      for (const m of marks) {
        const time = this.resolve(m.time);
        if (!time) continue;
        const x = timeScale.timeToCoordinate(time);
        if (x === null) continue;
        this.placed.push({ x, y, id: m.id });

        ctx.beginPath();
        ctx.arc(x * hr, y * vr, (RADIUS + HALO_PAD) * hr, 0, Math.PI * 2);
        ctx.fillStyle = theme.markerHalo;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x * hr, y * vr, RADIUS * hr, 0, Math.PI * 2);
        ctx.fillStyle = theme.dividend;
        ctx.fill();
      }
    });
  }
}
