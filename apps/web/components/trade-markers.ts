import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  IChartApi,
  PrimitiveHoveredItem,
  PrimitivePaneViewZOrder,
} from "lightweight-charts";
/** The slice of fancy-canvas's `CanvasRenderingTarget2D` this primitive uses.
 *  Declared locally rather than imported: fancy-canvas is a transitive
 *  dependency of lightweight-charts and is not resolvable from here, and adding
 *  a direct dependency for one type is not worth the supply-chain surface. */
interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
}
interface RenderTarget {
  useBitmapCoordinateSpace(fn: (scope: BitmapScope) => void): void;
}

export interface TradeMark {
  /** Series time key — must match a point in the series data. */
  time: string;
  direction: "buy" | "sell";
  /** Stable id the hover tooltip resolves back to a trade. */
  id: string;
}

export interface TradeMarkerTheme {
  marker: string;
  markerHalo: string;
}

/** Half-width of the triangle, CSS px. Also the halo radius before padding. */
const SIZE = 5;
/** Halo padding beyond the triangle, CSS px — this is the gap that separates a
 *  marker from the line running under it. */
const HALO_PAD = 2.5;
/** Cursor distance that counts as hovering a marker, CSS px. */
const HIT_RADIUS = 9;

interface Placed {
  x: number;
  y: number;
  direction: "buy" | "sell";
  id: string;
}

/**
 * Trade markers drawn as triangles on the price line.
 *
 * A custom primitive rather than the built-in markers plugin, because the
 * plugin has no triangle: its `arrowUp`/`arrowDown` draw a triangular head on a
 * rectangular stem, which reads as an arrow and does not match the ▲ / ▼ used
 * in the legend and the hover tooltip. The plugin also exposes no border, so
 * the halo previously had to be a second stacked marker.
 *
 * Direction is carried by the triangle's silhouette rather than by colour: the
 * price line is `--chart-line`, which is `--primary`, so a marker tinted with
 * the accent disappears into the line it sits on — the original defect. Shape
 * also survives colour blindness, which is why brokers mark fills this way.
 */
export class TradeMarkers implements ISeriesPrimitive {
  private placed: Placed[] = [];

  constructor(
    private readonly chart: IChartApi,
    private readonly series: ISeriesApi<"Area">,
    /** Snaps a trade date onto the series: markers ride the line, not the fill
     *  price, and a trade rarely falls exactly on a bar — weekends, holidays,
     *  and coarser sampling on long ranges all miss. Returning the nearest bar
     *  at or before the trade is what keeps a marker on screen; an exact-match
     *  lookup drops most of them silently. */
    private readonly resolve: (time: string) => { time: string; value: number } | undefined,
    private getMarks: () => TradeMark[],
    private getTheme: () => TradeMarkerTheme,
  ) {}

  setMarks(marks: () => TradeMark[]) {
    this.getMarks = marks;
  }

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

  /** Point-style hit: `hitTestPriority` 2 and a real distance so a marker wins
   *  over the series line underneath when both are under the cursor. */
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
    // Recomputed every frame and cached for hitTest, so pan and zoom stay
    // correct without an invalidation dance.
    this.placed = [];
    if (marks.length === 0) return;

    const theme = this.getTheme();
    const timeScale = this.chart.timeScale();

    for (const m of marks) {
      const bar = this.resolve(m.time);
      if (!bar) continue;
      // Both coordinates come from the snapped bar: `timeToCoordinate` returns
      // null for a time that is not on the scale.
      const x = timeScale.timeToCoordinate(bar.time);
      const y = this.series.priceToCoordinate(bar.value);
      if (x === null || y === null) continue;
      this.placed.push({ x, y, direction: m.direction, id: m.id });
    }

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;

      for (const p of this.placed) {
        const cx = p.x * hr;
        const cy = p.y * vr;
        const half = SIZE * hr;
        const height = SIZE * vr;
        const up = p.direction === "buy";

        // Halo first: punches a hole in the line so the triangle is not read as
        // a kink in the series.
        ctx.beginPath();
        ctx.arc(cx, cy, (SIZE + HALO_PAD) * hr, 0, Math.PI * 2);
        ctx.fillStyle = theme.markerHalo;
        ctx.fill();

        ctx.beginPath();
        if (up) {
          ctx.moveTo(cx, cy - height);
          ctx.lineTo(cx + half, cy + height * 0.75);
          ctx.lineTo(cx - half, cy + height * 0.75);
        } else {
          ctx.moveTo(cx, cy + height);
          ctx.lineTo(cx + half, cy - height * 0.75);
          ctx.lineTo(cx - half, cy - height * 0.75);
        }
        ctx.closePath();
        ctx.fillStyle = theme.marker;
        ctx.fill();
      }
    });
  }
}
