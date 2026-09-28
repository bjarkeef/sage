"use client";

import * as React from "react";
import type { PaymentCertainty } from "../../../lib/types";
import { monthKeyStartDay, type TapePoint } from "../../../lib/income-tape/points";
import { windowOf, type Extent, type View } from "../../../lib/income-tape/viewport";
import { changePct, ghostOf } from "../../../lib/income-tape/aggregates";
import { LABEL_LINE_PX, placeLabels } from "../../../lib/income-tape/labels";
import { PLOT_TOP, barHeight, barWidth, baseline } from "./geometry";

const TONE: Record<PaymentCertainty, string> = {
  paid: "var(--certainty-paid)",
  confirmed: "var(--certainty-confirmed)",
  estimated: "var(--certainty-estimated)",
};
const MONTH = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const signed = (n: number, digits: number) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

export interface TapeChartProps {
  points: TapePoint[];
  index: Map<string, TapePoint[]>;
  extent: Extent;
  todayDay: number;
  view: View;
  width: number;
  height: number;
  focus: string | null;
  hover: TapePoint | null;
  months: Map<number, number>;
  entering: boolean;
  worldRef: React.RefObject<SVGGElement | null>;
}

/** The world group's translate for the current view. Geometry is drawn at
 *  `geomPxPerDay` with x = 0 at `extent.firstDay`. */
export function worldTransform(v: View, extent: Extent, geomPxPerDay: number): string {
  return `translate(${-(v.leftDay - extent.firstDay) * geomPxPerDay},0)`;
}

function opacityFor(p: TapePoint, focus: string | null, hover: TapePoint | null): number {
  if (focus && p.symbol !== focus) return 0.12;
  if (hover && hover !== p) return 0.4;
  return 1;
}

/**
 * Every payment as one mark on a day axis. Drawn once per zoom level in world
 * coordinates; the parent pans it by setting `worldRef`'s transform, so a pan
 * never re-renders this component.
 */
export const TapeChart = React.memo(function TapeChart({
  points,
  index,
  extent,
  todayDay,
  view,
  width,
  height,
  focus,
  hover,
  months,
  entering,
  worldRef,
}: TapeChartProps) {
  const ppd = view.pxPerDay;
  const base = baseline(height);
  const X = (day: number) => (day - extent.firstDay) * ppd;
  const w = barWidth(ppd);
  const maxAmount = React.useMemo(() => Math.max(1, ...points.map((p) => p.amount)), [points]);
  const monthPx = 30.4 * ppd;
  const step = monthPx < 26 ? 3 : 1;

  const labels = React.useMemo(() => {
    if (entering) return { placed: [], ghosts: [] as { x: number; h: number }[] };
    const [a, b] = windowOf(view, width);
    const pad = width / ppd;
    const visible = points.filter((p) => p.day > a - pad && p.day < b + pad);
    const threshold = (maxAmount * 0.25) / Math.min(1, ppd / 2.2);
    const chosen = focus
      ? visible.filter((p) => p.symbol === focus)
      : visible.filter((p) => p.amount >= threshold);
    const ghosts: { x: number; h: number }[] = [];
    const candidates = [...chosen]
      .sort((p, q) => q.amount - p.amount)
      .map((p) => {
        const ghost = focus ? ghostOf(p, index) : null;
        const h = barHeight(p.amount, maxAmount, height);
        const gh = ghost ? barHeight(ghost.amount, maxAmount, height) : 0;
        if (ghost) ghosts.push({ x: X(p.day), h: gh });
        const change = ghost ? changePct(p.amount, ghost.amount) : null;
        const lines = [p.symbol, fmt(p.amount), ...(change != null ? [signed(change, 1)] : [])];
        return {
          key: `${p.symbol}-${p.iso}-${p.certainty}`,
          x: X(p.day),
          anchorTop: base - Math.max(h, gh),
          lines,
        };
      });
    return { placed: placeLabels(candidates, PLOT_TOP), ghosts };
    // X is derived from ppd and extent.firstDay, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entering, view, width, ppd, points, focus, index, maxAmount, height, base, extent.firstDay]);

  const monthKeys: number[] = [];
  {
    const d0 = new Date(extent.firstDay * 86_400_000);
    const d1 = new Date(extent.lastDay * 86_400_000);
    for (
      let k = d0.getUTCFullYear() * 12 + d0.getUTCMonth();
      k <= d1.getUTCFullYear() * 12 + d1.getUTCMonth();
      k++
    )
      monthKeys.push(k);
  }

  return (
    <svg
      width={width}
      height={height}
      className={entering ? "tape-enter block" : "block"}
      aria-hidden
    >
      <g ref={worldRef} transform={worldTransform(view, extent, ppd)}>
        <g>
          {monthKeys.map((k) => {
            const m = k % 12;
            const x = X(monthKeyStartDay(k));
            const cx = step === 1 ? X(monthKeyStartDay(k) + 15) : x + 4;
            const tot = months.get(k) ?? 0;
            const prev = months.get(k - 12) ?? 0;
            const ch = changePct(tot, prev);
            return (
              <g key={k}>
                <line
                  x1={x}
                  x2={x}
                  y1={24}
                  y2={height - 8}
                  stroke={m === 0 ? "var(--hairline)" : "var(--hairline-faint)"}
                />
                {m === 0 && (
                  <text x={x + 6} y={36} className="label-caps" fill="var(--muted-foreground)">
                    {Math.floor(k / 12)}
                  </text>
                )}
                {m % step === 0 && (
                  <text
                    x={cx}
                    y={base + 22}
                    textAnchor={step === 1 ? "middle" : "start"}
                    className="label-caps"
                    fill="var(--muted-foreground)"
                  >
                    {MONTH[m]}
                  </text>
                )}
                {step === 1 && monthPx >= 44 && (
                  <>
                    <text
                      x={cx}
                      y={base + 44}
                      textAnchor="middle"
                      className="font-mono text-data tabular-nums"
                      fill={tot ? "var(--foreground)" : "var(--muted-foreground)"}
                    >
                      {tot ? fmt(tot) : "·"}
                    </text>
                    {ch != null && tot > 0 && (
                      <text
                        x={cx}
                        y={base + 62}
                        textAnchor="middle"
                        className="font-mono text-xs tabular-nums"
                        fill={ch >= 0 ? "var(--gain)" : "var(--loss)"}
                      >
                        {signed(ch, 0)}
                      </text>
                    )}
                  </>
                )}
              </g>
            );
          })}
          <line x1={0} x2={X(extent.lastDay + 31)} y1={base} y2={base} stroke="var(--hairline)" />
          <line
            x1={X(todayDay)}
            x2={X(todayDay)}
            y1={44}
            y2={base}
            stroke="var(--muted-foreground)"
            strokeDasharray="2 3"
          />
          <text x={X(todayDay) + 6} y={56} className="label-caps" fill="var(--foreground)">
            TODAY
          </text>
        </g>

        <g>
          {labels.ghosts.map((g, i) => (
            <rect
              key={i}
              data-ghost
              x={g.x + w / 2 + 2}
              y={base - g.h}
              width={w}
              height={g.h}
              rx={1.5}
              fill="none"
              stroke="var(--foreground)"
              strokeOpacity={0.5}
              strokeDasharray="3 2"
            />
          ))}
        </g>

        <g>
          {points.map((p) => {
            const x = X(p.day);
            const h = barHeight(p.amount, maxAmount, height);
            const screenX = x - (view.leftDay - extent.firstDay) * ppd;
            const delay = Math.round(Math.min(1, Math.max(0, screenX / width)) * 250);
            return (
              <rect
                key={`${p.symbol}-${p.iso}-${p.certainty}`}
                data-bar
                x={x - w / 2}
                y={base - h}
                width={w}
                height={h}
                rx={Math.min(2, w / 3)}
                fill={TONE[p.certainty]}
                style={{
                  opacity: opacityFor(p, focus, hover),
                  transition: "opacity 200ms ease-out",
                  ["--rise-delay" as string]: `${delay}ms`,
                }}
              />
            );
          })}
        </g>

        <g>
          {labels.placed.map((l) => (
            <g key={l.key} data-label className="animate-[fade-in_180ms_ease-out_both]">
              {l.top + l.height < l.anchorTop - 2 && (
                <line
                  x1={l.x}
                  x2={l.x}
                  y1={l.top + l.height}
                  y2={l.anchorTop - 2}
                  stroke="var(--hairline)"
                />
              )}
              <rect
                x={l.x - l.width / 2}
                y={l.top}
                width={l.width}
                height={l.height}
                rx={4}
                fill="var(--background)"
                fillOpacity={0.88}
              />
              {l.lines.map((line, i) => (
                <text
                  key={i}
                  x={l.x}
                  y={l.top + 4 + (i + 1) * LABEL_LINE_PX - 3}
                  textAnchor="middle"
                  className="font-mono text-xs tabular-nums"
                  fill={
                    i === 0
                      ? "var(--foreground)"
                      : i === 2
                        ? line.startsWith("-")
                          ? "var(--loss)"
                          : "var(--gain)"
                        : "var(--muted-foreground)"
                  }
                >
                  {line}
                </text>
              ))}
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
});
