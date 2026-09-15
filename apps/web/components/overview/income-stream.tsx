"use client";

import * as React from "react";
import { netFactor } from "../../lib/dividend-tax";
import type { IncomeStreamPointDTO, PaymentCertainty } from "../../lib/types";

/**
 * Every dividend the book has been paid and expects to be paid, as one mark
 * each, on a twelve-months-back / twelve-months-forward axis.
 *
 * This is the overview's lead visual, and the argument for it is that it is the
 * only chart in the app a general portfolio tracker could not also draw. A
 * value-over-time line says the same thing on every finance page ever built; a
 * payment stream says *this book pays you on this rhythm, and here is how sure
 * that is* — which is the question a dividend account is actually run on.
 *
 * The tone ramp is not decoration and not a new vocabulary. `paid`,
 * `confirmed` and `estimated` are exactly the three arrays the income view
 * already separates (`retroactive` / `announced` / `projected`), and the
 * `--certainty-*` tokens they render in were contrast-validated in both themes
 * for the /dividends bars. So the picture literally fades as it moves right,
 * because that is what the data does — the future half is a forecast and is
 * drawn like one.
 *
 * Deliberately SVG rather than the lightweight-charts instance the value chart
 * uses: this is a categorical scatter of discrete events, not a continuous
 * series, and a canvas would cost a second charting runtime on the first paint
 * of the first page for a drawing that is a few hundred rects.
 */

/** Chart box. Height is fixed; width is measured, so one SVG unit is one CSS
 *  pixel and the mono tick labels stay crisp instead of being scaled by a
 *  viewBox fit. */
const HEIGHT = 208;
const BASELINE = 156;
const TOP = 14;
/** Two rows. Months on the first; the year on a second row under January only.
 *  Setting the year inline on the January tick ("JAN 2027") is ~52px of text in
 *  a ~50px slot, so it printed straight through February — "JAN 202FEB" on a
 *  1440 screen. A second row cannot collide with anything by construction. */
const MONTH_LABEL_Y = 180;
const YEAR_LABEL_Y = 196;

const TONE: Record<PaymentCertainty, string> = {
  paid: "var(--certainty-paid)",
  confirmed: "var(--certainty-confirmed)",
  estimated: "var(--certainty-estimated)",
};

const MONTH = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** Rendered width of a three-letter mono label at 11px with 0.12em tracking,
 *  plus its 4px offset. Measuring it properly would cost a layout pass per
 *  tick for a number that cannot change. */
const MONTH_LABEL_W = 34;

function dayNumber(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
}

/** First of each month covered by the window, as ISO. */
function monthStarts(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let y = +fromIso.slice(0, 4);
  let m = +fromIso.slice(5, 7) - 1;
  for (let i = 0; i < 40; i++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    if (iso > toIso) break;
    if (iso >= fromIso) out.push(iso);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

export function IncomeStream({
  points,
  todayISO,
  taxRate,
  onHover,
  className,
}: {
  points: IncomeStreamPointDTO[];
  todayISO: string;
  /** Flat dividend tax rate (0-100) or null. Applied here so the bars agree
   *  with the after-tax figure above them rather than towering over it. */
  taxRate: number | null;
  /** The mark under the pointer, or null. The figure above reads this, the way
   *  the value chart's scrub rewrote the old hero — one instrument, not a
   *  tooltip floating over an unrelated total. */
  onHover?: (point: IncomeStreamPointDTO | null) => void;
  className?: string;
}) {
  const [width, setWidth] = React.useState(0);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry!.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const factor = netFactor(taxRate);

  const geometry = React.useMemo(() => {
    if (points.length === 0 || width === 0) return null;

    // The window is the twelve months either side of today, not the extent of
    // the data. A book whose oldest payment is four months old should show four
    // months of marks against a year of ground, rather than stretching those
    // four months across the full width and implying a density it does not
    // have.
    const from = points[0]!.date < todayISO ? points[0]!.date : todayISO;
    const last = points.at(-1)!.date;
    const to = last > todayISO ? last : todayISO;

    const d0 = dayNumber(from);
    const d1 = dayNumber(to);
    const span = Math.max(1, d1 - d0);
    const pad = 8;
    const x = (iso: string) => pad + ((dayNumber(iso) - d0) / span) * (width - pad * 2);

    const amounts = points.map((p) => Number(p.amount) * factor);
    const max = Math.max(...amounts, 1);

    // A gap between neighbouring marks, so a run of monthly payers reads as a
    // comb rather than a solid block — but never below 2px, or a dense book
    // renders as a smear.
    const barW = Math.max(2, Math.min(6, (width - pad * 2) / Math.max(points.length, 1) - 1.5));

    const bars = points.map((p, i) => {
      const h = Math.max(2, (amounts[i]! / max) * (BASELINE - TOP));
      return { x: x(p.date), h, amount: amounts[i]!, point: p };
    });

    // One label per `labelStep` months, so no two ever touch.
    const months = Math.max(1, Math.round((d1 - d0) / 30.4));
    const labelStep = Math.max(1, Math.ceil(MONTH_LABEL_W / ((width - pad * 2) / months)));

    return { bars, barW, x, from, to, todayX: x(todayISO), labelStep };
  }, [points, width, todayISO, factor]);

  const setHover = (i: number | null) => {
    setHoverIdx(i);
    onHover?.(i == null ? null : (points[i] ?? null));
  };

  return (
    <div ref={hostRef} className={className}>
      {geometry && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`Every dividend payment from ${geometry.from} to ${geometry.to}: ${points.length} payments, drawn as a mark whose height is the amount and whose tone is how certain it is.`}
          onPointerLeave={() => setHover(null)}
        >
          <line
            x1={0}
            y1={BASELINE + 0.5}
            x2={width}
            y2={BASELINE + 0.5}
            stroke="var(--hairline)"
            strokeWidth={1}
          />

          {monthStarts(geometry.from, geometry.to).map((iso, i) => {
            const px = geometry.x(iso);
            const m = +iso.slice(5, 7) - 1;
            // Every month fits at desktop width; on a 375px phone twenty-four
            // of them collide into a grey smear (measured: 18 overlapping
            // pairs). Thin by whole months so the surviving labels stay evenly
            // spaced — dropping "the ones that would overlap" leaves a ragged
            // axis whose gaps look like missing data.
            const labelled = i % geometry.labelStep === 0;
            // A label whose text would run past the right edge is clipped
            // rather than drawn — the final tick of the window lands within a
            // few pixels of the edge more often than not.
            const roomForLabel = px + MONTH_LABEL_W < width;
            return (
              <g key={iso}>
                <line
                  x1={px}
                  y1={BASELINE}
                  x2={px}
                  y2={BASELINE + (m === 0 ? 7 : 4)}
                  stroke="var(--hairline)"
                  strokeWidth={1}
                />
                {labelled && roomForLabel && (
                  <text
                    x={px + 4}
                    y={MONTH_LABEL_Y}
                    className="label-caps"
                    fill="var(--muted-foreground)"
                    opacity={0.65}
                  >
                    {MONTH[m]}
                  </text>
                )}
                {m === 0 && labelled && roomForLabel && (
                  <text
                    x={px + 4}
                    y={YEAR_LABEL_Y}
                    className="label-caps"
                    fill="var(--muted-foreground)"
                    opacity={0.45}
                  >
                    {iso.slice(0, 4)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Today, drawn over the axis but under the marks: the split between
              what happened and what is forecast is the chart's one structural
              claim, so it is a rule rather than a colour change alone. */}
          <line
            x1={geometry.todayX}
            y1={TOP - 8}
            x2={geometry.todayX}
            y2={BASELINE}
            stroke="var(--foreground)"
            strokeWidth={1}
            opacity={0.5}
          />
          <text
            x={geometry.todayX + 6}
            y={TOP - 1}
            className="label-caps"
            fill="var(--foreground)"
            opacity={0.65}
          >
            TODAY
          </text>

          {geometry.bars.map((b, i) => (
            <rect
              key={`${b.point.symbol}-${b.point.date}-${i}`}
              x={b.x - geometry.barW / 2}
              y={BASELINE - b.h}
              width={geometry.barW}
              height={b.h}
              rx={Math.min(2, geometry.barW / 2)}
              fill={TONE[b.point.certainty]}
              opacity={hoverIdx == null || hoverIdx === i ? 1 : 0.4}
              onPointerEnter={() => setHover(i)}
            />
          ))}

          {/* One transparent band per mark, wider than the mark itself. At 3px
              the rects are a hard target for a pointer, and a chart you have to
              aim at is a chart nobody hovers. */}
          {geometry.bars.map((b, i) => (
            <rect
              key={`hit-${i}`}
              x={b.x - Math.max(5, geometry.barW)}
              y={TOP - 8}
              width={Math.max(10, geometry.barW * 2)}
              height={BASELINE - TOP + 8}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
