"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardTitle } from "@sage/ui";
import type { MonthlyRhythmRow } from "../../lib/dividend-derive";
import { formatMoney } from "../../lib/format";
import { ActArrow } from "./kpi-cards";
import { ChartTooltip } from "../charts/chart-tooltip";
import { AXIS_TICK, CURSOR_FILL, GRID_STROKE } from "../charts/chart-theme";

function monthTick(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).charAt(0);
}

function monthFull(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function MonthlyRhythm({
  rows,
  currency = "USD",
}: {
  rows: MonthlyRhythmRow[];
  currency?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <Card
      compact
      className="group relative flex h-full flex-col transition-colors hover:bg-surface-hover/60"
    >
      <ActArrow />
      <div className="mb-3.5">
        <CardTitle className="mb-0">Monthly rhythm</CardTitle>
        <div className="text-xs text-muted-foreground">Received per month, last 12</div>
      </div>

      <div className="flex-1" style={{ minHeight: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 6, left: 6, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickFormatter={monthTick}
              interval={0}
              dy={4}
            />
            <YAxis hide domain={[0, "dataMax"]} />
            <Tooltip
              cursor={{ fill: CURSOR_FILL }}
              content={
                <ChartTooltip
                  hideName
                  labelFormatter={(label) => monthFull(String(label))}
                  valueFormatter={(value) => formatMoney({ amount: String(value), currency })}
                />
              }
            />
            <Bar dataKey="amount" fill="var(--income)" radius={[5, 5, 2, 2]} maxBarSize={30} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
