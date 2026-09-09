"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardTitle } from "@sage/ui";
import type { TimelinePoint } from "../../lib/dividend-year";
import { formatMoney } from "../../lib/format";
import { ActArrow } from "./kpi-cards";
import { ChartTooltip } from "../charts/chart-tooltip";
import { AXIS_TICK, CURSOR_FILL, GRID_STROKE, LABEL_STYLE } from "../charts/chart-theme";

/** Corner radii for one bar. Recharts merges a `<Cell>`'s props onto the rect
 *  it draws for that datum, which is how a stacked bar gets per-year corners —
 *  but `Cell`'s props come from `SVGProps`, where `radius` is a scalar. The
 *  four-corner tuple is what `Bar` itself accepts, hence the widening. */
export function corners(radius: [number, number, number, number]) {
  return { radius } as unknown as { radius: number };
}

/** The year's total, drawn above the `received` bar. A finished year's cap
 *  IS that bar, so its one figure belongs there. The year in progress states
 *  its two parts separately instead (`timelineReceivedLabel` /
 *  `timelineExpectedLabel`) — this returns "" for it, including a current
 *  year with nothing left expected (`projected` already 0), where the
 *  received-segment label below covers the same ground. Pulled out as a pure
 *  function, like `forwardBarLabel` in the sibling chart, because Recharts
 *  never lays out its SVG under jsdom (`ResponsiveContainer` measures 0×0
 *  there), so a `screen.getByText` on chart label text cannot discriminate
 *  pass from fail — only a direct call on the decision itself can. */
export function timelineTotalLabel(point: TimelinePoint | undefined): string {
  if (!point || point.projected > 0) return "";
  return Math.round(point.total).toLocaleString();
}

/** The received figure for the year in progress, drawn inside its own solid
 *  segment — money that has actually arrived, never fused with the forecast
 *  above it. "" for a finished year (covered by `timelineTotalLabel`) and for
 *  a current year with nothing left expected, where `received === total` and
 *  that single total label already says everything a second label would.
 *  Also "" when nothing has arrived yet (early January, say): Recharts draws
 *  no rectangle for a zero-height stack segment (see the `corners()` comment
 *  below), so a label placed `insideTop` on one has nothing to sit inside —
 *  the rounded value is checked, not the raw one, so a sub-0.5 amount that
 *  rounds down to zero is caught the same way a literal zero is. Mirrors
 *  `timelineExpectedLabel`'s own-value guard below — one rule, applied to
 *  each segment's own figure. */
export function timelineReceivedLabel(point: TimelinePoint | undefined): string {
  if (!point || point.projected <= 0) return "";
  const received = Math.round(point.received);
  if (received <= 0) return "";
  return received.toLocaleString();
}

/** The still-expected figure for the year in progress, above the hatched
 *  segment, phrased as an addition — "+1,183 expected", never a bare
 *  "1,183" — so it cannot be misread as the stack's total. That fused
 *  reading is the exact defect this pair of labels replaces. "" whenever
 *  there is nothing left to expect: a finished year, a current year that has
 *  already collected everything forecast, or a current year whose remaining
 *  forecast rounds down to zero (no `+0 expected`) — the same own-value
 *  guard `timelineReceivedLabel` applies above, mirrored here. */
export function timelineExpectedLabel(point: TimelinePoint | undefined): string {
  if (!point || point.projected <= 0) return "";
  const expected = Math.round(point.projected);
  if (expected <= 0) return "";
  return `+${expected.toLocaleString()} expected`;
}

/**
 * Dividend income per year: what arrived, and — for the year in progress —
 * what is still expected.
 *
 * It ends at the current year deliberately. The projection reaches twelve
 * months from today, not to the end of next calendar year, so a next-year
 * column would be a partial year drawn at full width and would read as a
 * collapse in income. `/goal` answers the long-horizon question properly, with
 * the user's own contribution and reinvestment settings behind it.
 */
export function IncomeTimeline({
  points,
  currency,
  incomeRecordingOff = false,
}: {
  points: TimelinePoint[];
  currency: string;
  incomeRecordingOff?: boolean;
}) {
  if (points.length === 0) {
    if (!incomeRecordingOff) return null;
    return (
      <Card compact className="flex h-full flex-col">
        <CardTitle className="mb-0">Income by year</CardTitle>
        <div className="mt-3 text-xs text-muted-foreground">
          No dividends recorded yet. Turn on dividend recording in{" "}
          <Link
            href="/settings"
            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            Settings
          </Link>{" "}
          to build your income history.
        </div>
      </Card>
    );
  }

  const money = (v: unknown) => formatMoney({ amount: String(v), currency });

  return (
    <Card
      compact
      className="group relative flex h-full flex-col transition-colors hover:bg-surface-hover/60"
    >
      <ActArrow />
      <div className="mb-3.5">
        <CardTitle className="mb-0">Income by year</CardTitle>
        <div className="text-xs text-muted-foreground">Received, and still expected this year</div>
      </div>

      {/* Diagonal hatch for the not-yet-received portion — an SVG <pattern>
          referenced by id, defined in a 0-size svg so the chart can fill with
          it. Same device the received-only chart used for its in-progress year. */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <pattern
            id="timeline-hatch"
            patternUnits="userSpaceOnUse"
            width="7"
            height="7"
            patternTransform="rotate(135)"
          >
            <rect width="7" height="7" fill="var(--income)" fillOpacity={0.22} />
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--income)" strokeWidth="3.5" />
          </pattern>
        </defs>
      </svg>

      <div className="flex-1" style={{ minHeight: 196 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="year" tickLine={false} axisLine={false} tick={AXIS_TICK} dy={4} />
            <YAxis hide domain={[0, "dataMax"]} />
            <Tooltip
              cursor={{ fill: CURSOR_FILL }}
              content={<ChartTooltip valueFormatter={(value) => money(value)} />}
            />
            <Bar
              dataKey="received"
              stackId="year"
              fill="var(--income)"
              name="Received"
              maxBarSize={54}
            >
              {/* A finished year is one whole bar and gets the rounded top the
                  chart this replaced drew. The year in progress carries the
                  hatched remainder on top of it, so rounding there would open
                  a notch at the seam — it keeps a square top and the segment
                  above it supplies the cap. */}
              {points.map((p) => (
                <Cell key={p.year} {...corners(p.projected > 0 ? [0, 0, 2, 2] : [6, 6, 2, 2])} />
              ))}
              {/* The year's total, above the bar. A finished year's cap IS this
                  bar, so its label belongs here; the year in progress is
                  labelled on the segment above instead — recharts draws no
                  rectangle, and so no label, for a zero-height stack segment,
                  which is why one LabelList cannot serve both. */}
              <LabelList
                position="top"
                style={LABEL_STYLE}
                valueAccessor={(entry) =>
                  timelineTotalLabel(entry.payload as TimelinePoint | undefined)
                }
              />
              {/* The year in progress only: the received figure, set inside
                  its own solid segment rather than above it — "above" would
                  land inside the hatched segment stacked directly on top,
                  since there is no gap at the seam (see the corners() comment
                  below). `--background` is used instead of the shared
                  LABEL_STYLE's muted-foreground fill because muted-foreground
                  is tuned to read against the card, not against solid
                  `--income`: at gold-500/gray-50 (light) that pairing is
                  ~5.8:1, at gold-300/gray-950 (dark) ~10.5:1 — both clear the
                  4.5:1 text floor, and both hold because `--background` is
                  chosen to sit at the opposite end of the lightness scale
                  from whichever `--income` step is active in that theme. */}
              <LabelList
                position="insideTop"
                style={{ ...LABEL_STYLE, fill: "var(--background)" }}
                valueAccessor={(entry) =>
                  timelineReceivedLabel(entry.payload as TimelinePoint | undefined)
                }
              />
            </Bar>
            <Bar
              dataKey="projected"
              stackId="year"
              fill="url(#timeline-hatch)"
              stroke="var(--income)"
              strokeOpacity={0.5}
              name="Still expected"
              radius={[6, 6, 0, 0]}
              maxBarSize={54}
            >
              {/* The year in progress: what's still expected, above the
                  hatched remainder, phrased as an addition so it can never
                  read as the stack's total (see `timelineExpectedLabel`).
                  Without this the figure would be hover-only — a step down
                  from the chart this replaced. */}
              <LabelList
                position="top"
                style={LABEL_STYLE}
                valueAccessor={(entry) =>
                  timelineExpectedLabel(entry.payload as TimelinePoint | undefined)
                }
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-[11px] w-[11px] rounded-full bg-income" />
          Received
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-[11px] w-[11px] rounded-full border border-income"
            style={{ background: "var(--income)", opacity: 0.35 }}
          />
          Still expected
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Ends at this year — payment dates are only forecast twelve months out. For a longer horizon
        see{" "}
        <Link
          href="/goal"
          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          your goal
        </Link>
        , which projects income across scenarios.
      </p>
    </Card>
  );
}
