import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

/** One day: what the book was worth, and what had been paid into it. */
export interface GainBandPoint {
  time: Time;
  value: number;
  invested: number;
}

export interface GainBandOptions {
  points: () => readonly GainBandPoint[];
  /** Fill where value is at or above money in, and where it is below. */
  gainFill: () => string;
  lossFill: () => string;
  /** 0–1 left-to-right reveal, for the entrance. Omit for a static band. */
  progress?: () => number;
}

/** A projected point: x across the pane, y of each series, in screen space. */
export interface BandPoint {
  x: number;
  yv: number;
  yi: number;
}

/** A stretch of days on one side of the crossing. `sign` is +1 where the book
 *  is worth at least what was paid in. */
export interface BandRun {
  sign: 1 | -1;
  points: BandPoint[];
}

/**
 * Split projected points into runs that never mix a gain stretch with a loss
 * stretch, meeting exactly on the crossing.
 *
 * Pure and exported for its tests: the drawing itself needs a canvas, which
 * jsdom does not lay out, but this is where the arithmetic that could be wrong
 * lives. Screen y grows downward, so the sign is read from `yi - yv` rather
 * than from the prices — reading it off the prices would invert every colour
 * the day someone flips an axis.
 */
export function splitSignRuns(proj: readonly BandPoint[]): BandRun[] {
  if (proj.length < 2) return [];
  const gap = (p: BandPoint) => p.yi - p.yv;
  const runs: BandRun[] = [];
  let sign: 1 | -1 = gap(proj[0]!) >= 0 ? 1 : -1;
  let points: BandPoint[] = [proj[0]!];

  for (let i = 1; i < proj.length; i++) {
    const prev = proj[i - 1]!;
    const curr = proj[i]!;
    const s: 1 | -1 = gap(curr) >= 0 ? 1 : -1;
    if (s !== sign) {
      const d0 = gap(prev);
      const d1 = gap(curr);
      const t = d0 / (d0 - d1);
      const cy = prev.yv + (curr.yv - prev.yv) * t;
      // The meeting point sits on both series at once — the band has zero
      // height exactly there, which is what "the crossing" means.
      const meet: BandPoint = { x: prev.x + (curr.x - prev.x) * t, yv: cy, yi: cy };
      points.push(meet);
      runs.push({ sign, points });
      points = [meet];
      sign = s;
    }
    points.push(curr);
  }
  runs.push({ sign, points });
  return runs.filter((r) => r.points.length >= 2);
}

/**
 * Fills the space between the portfolio's value and the money paid into it.
 *
 * **Why this is a primitive rather than two series and a fill.**
 * lightweight-charts can fill between a series and a *constant* price
 * (`BaselineSeries`), which is not what this is: the floor here is another
 * series that moves. Nothing in the library draws between two series, so the
 * band is drawn onto the pane canvas using the chart's own coordinate
 * converters — the sanctioned extension point, and the reason `docs/CHARTS.md`
 * rule 4 ("do not add a third chart library") does not need bending.
 *
 * **Why the band is worth the code.** A deposit lifts value and money in by the
 * same amount on the same day, so the band does not move when money is paid in.
 * That is the whole point: it is the one reading on this chart that a user's own
 * cash cannot inflate. The benchmark overlay this replaced had exactly the
 * opposite property.
 *
 * Runs are split at the crossing rather than tinted whole, so a year that went
 * under water and came back reads as two facts, not one averaged one.
 */
export function createGainBand(opts: GainBandOptions): ISeriesPrimitive<Time> {
  let attached: SeriesAttachedParameter<Time, SeriesType> | null = null;

  const renderer: IPrimitivePaneRenderer = {
    draw(target) {
      const params = attached;
      if (!params) return;
      const pts = opts.points();
      if (pts.length < 2) return;

      const series = params.series;
      const timeScale = params.chart.timeScale();

      // Project once. `timeToCoordinate` returns null for a point outside the
      // visible range and `priceToCoordinate` for a price outside the pane, so
      // both are filtered before any geometry is built.
      const proj: BandPoint[] = [];
      for (const p of pts) {
        const x = timeScale.timeToCoordinate(p.time);
        const yv = series.priceToCoordinate(p.value);
        const yi = series.priceToCoordinate(p.invested);
        if (x === null || yv === null || yi === null) continue;
        proj.push({ x, yv, yi });
      }
      if (proj.length < 2) return;

      target.useMediaCoordinateSpace((scope) => {
        const ctx = scope.context;
        const cut = opts.progress ? opts.progress() * scope.mediaSize.width : Infinity;
        if (cut <= 0) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, Math.min(cut, scope.mediaSize.width), scope.mediaSize.height);
        ctx.clip();

        for (const run of splitSignRuns(proj)) {
          ctx.beginPath();
          ctx.moveTo(run.points[0]!.x, run.points[0]!.yv);
          for (let i = 1; i < run.points.length; i++)
            ctx.lineTo(run.points[i]!.x, run.points[i]!.yv);
          for (let i = run.points.length - 1; i >= 0; i--)
            ctx.lineTo(run.points[i]!.x, run.points[i]!.yi);
          ctx.closePath();
          ctx.fillStyle = run.sign > 0 ? opts.gainFill() : opts.lossFill();
          ctx.fill();
        }
        ctx.restore();
      });
    },
  };

  const paneView: IPrimitivePaneView = {
    // Beneath the series lines, above the grid: the band is context for the
    // two lines that bound it, and must never draw over them.
    zOrder: () => "bottom",
    renderer: () => renderer,
  };

  return {
    attached(params: SeriesAttachedParameter<Time, SeriesType>) {
      attached = params;
    },
    detached() {
      attached = null;
    },
    paneViews: () => [paneView],
  };
}
