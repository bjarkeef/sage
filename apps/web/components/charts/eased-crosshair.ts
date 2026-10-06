import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}
interface RenderTarget {
  useBitmapCoordinateSpace(fn: (scope: BitmapScope) => void): void;
}

/** DESIGN.md Motion: "a crosshair eases toward its target (~120ms) rather than
 *  welding to the cursor". */
export const CROSSHAIR_TAU_MS = 120;
const SNAP_PX = 0.25;

/** One frame of exponential easing, frame-rate independent. */
export function easeStep(
  current: number,
  target: number,
  dtMs: number,
  tauMs = CROSSHAIR_TAU_MS,
): number {
  if (dtMs <= 0) return current;
  const next = current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
  return Math.abs(target - next) < SNAP_PX ? target : next;
}

/**
 * A vertical crosshair and a dot on the line that ease toward the pointer.
 * The built-in crosshair line is hidden on the asset chart: it welds to the
 * cursor, which reads as a tooltip rather than as a precise instrument. The
 * figures in the header do NOT ease — they change the instant the hovered day
 * changes. Under reduced motion the crosshair jumps, never slower.
 */
export class EasedCrosshair implements ISeriesPrimitive<Time> {
  private pos: { x: number; y: number } | null = null;
  private target: { x: number; y: number } | null = null;
  private raf = 0;
  private last = 0;
  private requestUpdate: (() => void) | null = null;

  constructor(
    private readonly getColors: () => { line: string; dot: string; halo: string },
    private readonly reducedMotion: () => boolean,
  ) {}

  attached(param: SeriesAttachedParameter<Time>) {
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.requestUpdate = null;
  }

  /** Where it is drawn right now. */
  get position(): { x: number; y: number } | null {
    return this.pos;
  }

  setTarget(target: { x: number; y: number } | null) {
    this.target = target;
    if (!target) {
      this.pos = null;
      this.requestUpdate?.();
      return;
    }
    if (!this.pos || this.reducedMotion()) {
      this.pos = { ...target };
      this.requestUpdate?.();
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    const dt = now - this.last;
    this.last = now;
    if (!this.target || !this.pos) {
      this.raf = 0;
      return;
    }
    this.pos = {
      x: easeStep(this.pos.x, this.target.x, dt),
      y: easeStep(this.pos.y, this.target.y, dt),
    };
    this.requestUpdate?.();
    const settled = this.pos.x === this.target.x && this.pos.y === this.target.y;
    this.raf = settled ? 0 : requestAnimationFrame(this.tick);
  };

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

  private draw(target: RenderTarget) {
    const p = this.pos;
    if (!p) return;
    const c = this.getColors();
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const x = Math.round(p.x * hr) + 0.5;

      ctx.save();
      ctx.strokeStyle = c.line;
      ctx.lineWidth = Math.max(1, Math.floor(hr));
      ctx.setLineDash([4 * hr, 4 * hr]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, scope.mediaSize.height * vr);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(p.x * hr, p.y * vr, 5.5 * hr, 0, Math.PI * 2);
      ctx.fillStyle = c.halo;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x * hr, p.y * vr, 4 * hr, 0, Math.PI * 2);
      ctx.fillStyle = c.dot;
      ctx.fill();
    });
  }
}
