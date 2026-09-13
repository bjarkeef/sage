import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

export interface CurtainOptions {
  /** Where the covered region starts, as a fraction of pane width (0–1).
   *  `null` draws nothing at all. */
  from: () => number | null;
  /** Fill for the covered region. Opaque to hide, translucent to dim. */
  fill: () => string;
  /** Receives the chart's own redraw trigger on attach. An animation has to be
   *  able to ask for frames: nothing else changes, so without this the chart
   *  would never repaint and the curtain would sit wherever it was first drawn. */
  onAttach?: (requestUpdate: () => void) => void;
}

/**
 * Covers the right-hand part of the pane.
 *
 * Used twice, for two jobs that are the same drawing:
 *
 *  - **The entrance.** The series hold their FULL data from the first frame, and
 *    this hides everything past the sweep. The obvious alternative — feeding a
 *    growing slice to `setData` — does not work: lightweight-charts re-anchors
 *    the visible range to the newest bars on every `setData`, so a chart part
 *    way through drew its data crammed against the right edge at a different bar
 *    spacing and expanded leftwards as it filled. It read as the whole chart
 *    flying in from the right and snapping into place, which is exactly what it
 *    was. Whitespace tail-padding does not prevent it either.
 *
 *    Covering instead of feeding means the axis, the bar spacing and the price
 *    scale are final from the first frame; the only thing that changes is how
 *    much of the drawing you can see.
 *
 *  - **The hover.** The same rectangle at low alpha dims everything after the
 *    pointer, so the eye reads "up to here" rather than inferring it from a
 *    vertical rule alone.
 */
export function createCurtain(opts: CurtainOptions): ISeriesPrimitive<Time> {
  let attached: SeriesAttachedParameter<Time, SeriesType> | null = null;

  const renderer: IPrimitivePaneRenderer = {
    draw(target) {
      if (!attached) return;
      const fraction = opts.from();
      if (fraction === null || fraction >= 1) return;

      target.useMediaCoordinateSpace((scope) => {
        const x = Math.max(0, fraction) * scope.mediaSize.width;
        const w = scope.mediaSize.width - x;
        if (w <= 0) return;
        const ctx = scope.context;
        ctx.save();
        ctx.fillStyle = opts.fill();
        ctx.fillRect(x, 0, w, scope.mediaSize.height);
        ctx.restore();
      });
    },
  };

  const paneView: IPrimitivePaneView = {
    // Above the series: this hides or dims the lines themselves, which is the
    // whole point. The gain band draws at "bottom" and is covered too.
    zOrder: () => "top",
    renderer: () => renderer,
  };

  return {
    attached(params: SeriesAttachedParameter<Time, SeriesType>) {
      attached = params;
      opts.onAttach?.(() => params.requestUpdate());
    },
    detached() {
      attached = null;
    },
    paneViews: () => [paneView],
  };
}
