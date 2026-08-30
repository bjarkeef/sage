"use client";

import * as React from "react";
import { Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import { ChartTooltip } from "../charts/chart-tooltip";
import { CURSOR_FILL, segColor } from "../charts/chart-theme";

/** The box is 200px, so the largest radius has to stay under 100. */
const INNER = 48;
/** The radius a segment sits at when it is exactly on target — where the
 *  dashed ring is drawn. */
const RING = 74;
const MIN = 58;
const MAX = 92;
/** Pixels of radius per 1.0 of actual/target deviation. At this scale a
 *  segment saturates at roughly half or double its target, which is far
 *  enough off that the exact amount stops mattering. */
const SCALE = 34;

export interface DonutRow {
  id: string;
  label: string;
  actualPct: number;
  targetPct: number | null;
}

/** A segment's outer radius encodes how far it is from its target. Rows with
 *  no target sit exactly on the ring — they are drawn faded, because "on the
 *  ring" would otherwise read as "on target". */
function radiusFor(row: DonutRow): number {
  if (row.targetPct == null || row.targetPct <= 0) return RING;
  const ratio = row.actualPct / row.targetPct;
  return Math.min(MAX, Math.max(MIN, RING + (ratio - 1) * SCALE));
}

interface SectorLike {
  cx?: number;
  cy?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
  payload?: { payload?: DonutRow } & Partial<DonutRow>;
}

export function AllocationDonut({ rows, title }: { rows: DonutRow[]; title: string }) {
  // Recharts nests the datum one level deep on the sector payload in some
  // code paths and not in others; take whichever carries the row.
  const rowOf = (props: SectorLike): DonutRow | undefined =>
    (props.payload?.payload ?? props.payload) as DonutRow | undefined;

  const anyTarget = rows.some((r) => r.targetPct != null);

  return (
    <div className="relative mx-auto h-[200px] w-[200px]" data-testid="allocation-donut">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            cursor={{ fill: CURSOR_FILL }}
            content={
              <ChartTooltip
                hideName
                labelFormatter={(_label, payload) => String(payload?.[0]?.name ?? "")}
                valueFormatter={(value) => `${Number(value).toFixed(1)}%`}
              />
            }
          />
          <Pie
            data={rows}
            dataKey="actualPct"
            nameKey="label"
            innerRadius={INNER}
            outerRadius={RING}
            startAngle={90}
            endAngle={-270}
            paddingAngle={1}
            isAnimationActive={false}
            stroke="var(--card)"
            strokeWidth={2}
            shape={(props: SectorLike) => {
              const row = rowOf(props);
              const index = row ? rows.findIndex((r) => r.id === row.id) : -1;
              return (
                <Sector
                  {...props}
                  innerRadius={INNER}
                  outerRadius={row ? radiusFor(row) : RING}
                  fill={segColor(index < 0 ? rows.length : index)}
                  fillOpacity={row?.targetPct == null ? 0.45 : 1}
                />
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* The target ring. Drawn as an overlay rather than a Recharts layer so
          it stays exactly concentric with the pie at any container size, and
          so it is absent — not zero-radius — when nothing has a target. */}
      {anyTarget && (
        <svg
          className="pointer-events-none absolute inset-0"
          viewBox="0 0 200 200"
          aria-hidden="true"
        >
          <circle
            cx="100"
            cy="100"
            r={RING}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        </svg>
      )}

      <span className="sr-only">{title}</span>
    </div>
  );
}
