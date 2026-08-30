"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GoalScenarioDTO } from "../../lib/types";
import { formatMoney } from "../../lib/format";
import { ChartTooltip } from "../charts/chart-tooltip";
import { AXIS_TICK, GRID_STROKE } from "../charts/chart-theme";

/** Abbreviation is a property of the axis, not of the tick: mixing `1k` with
 *  `750` on one axis makes the reader rescale between gridlines. If the axis
 *  maximum abbreviates, every tick on it does. */
export function formatAxisValue(v: number, axisMax: number): string {
  // Zero is the one exception, and not a violation of the rule above: it has no
  // magnitude to scale, so `0.0k` reads as a rounding artefact rather than as a
  // unit. Recharts puts a zero tick on the baseline of nearly every axis.
  if (v === 0) return "0";
  if (axisMax >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (axisMax >= 1000) return `${(v / 1000).toFixed(2).replace(/0$/, "")}k`;
  return String(Math.round(v));
}

export interface GoalChartPoint {
  year: number;
  goal: number;
  portfolio: number | null;
  alternative: number | null;
}

/** Merge scenario rows into one per-year series; exported for unit tests
 *  (Recharts renders 0×0 in jsdom, so the logic must be testable standalone). */
export function buildChartData(
  scenarios: GoalScenarioDTO[],
  mode: "passive_income" | "value",
): GoalChartPoint[] {
  const metric = (r: { income: string; value: string }) =>
    Number(mode === "value" ? r.value : r.income);
  const portfolio = scenarios.find((s) => s.id === "portfolio");
  const alternative = scenarios.find((s) => s.id === "alternative");
  const altByYear = new Map((alternative?.rows ?? []).map((r) => [r.year, r]));
  return (portfolio?.rows ?? []).map((r) => ({
    year: r.year,
    goal: Number(r.goal),
    portfolio: metric(r),
    alternative: altByYear.has(r.year) ? metric(altByYear.get(r.year)!) : null,
  }));
}

export function GoalProjectionChart({
  scenarios,
  mode,
  targetYear,
  currency,
}: {
  scenarios: GoalScenarioDTO[];
  mode: "passive_income" | "value";
  targetYear: number;
  currency: string;
}) {
  const data = buildChartData(scenarios, mode);
  const hasAlternative = data.some((d) => d.alternative != null);
  // All three series share one y-axis, so the formatter has to see every one
  // of them — deriving this from just portfolio/goal would let the axis
  // maximum and the alternative-scenario line disagree on units.
  const axisMax = React.useMemo(
    () => Math.max(0, ...data.flatMap((d) => [d.portfolio ?? 0, d.goal ?? 0, d.alternative ?? 0])),
    [data],
  );

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="label-caps">Projection</span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-0.5 w-4 rounded-full" style={{ background: "var(--primary)" }} />{" "}
          Portfolio
        </span>
        {hasAlternative && (
          <span className="inline-flex items-center gap-1.5">
            <i className="h-0.5 w-4 rounded-full" style={{ background: "var(--seg-2)" }} />{" "}
            Alternative
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <i className="h-0 w-4 border-t border-dashed" style={{ borderColor: "var(--income)" }} />{" "}
          Goal
        </span>
      </div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="year" tickLine={false} axisLine={false} tick={AXIS_TICK} dy={4} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              width={48}
              tickFormatter={(v: number) => formatAxisValue(v, axisMax)}
            />
            <Tooltip
              content={
                <ChartTooltip
                  labelFormatter={(label) => String(label)}
                  valueFormatter={(value) => formatMoney({ amount: String(value), currency })}
                />
              }
            />
            <ReferenceLine
              x={targetYear}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              label={{
                value: `🏁 ${targetYear}`,
                position: "top",
                fontSize: 10,
                fill: "var(--muted-foreground)",
              }}
            />
            <Line
              type="monotone"
              dataKey="goal"
              name="Goal"
              stroke="var(--income)"
              strokeDasharray="5 4"
              dot={false}
              strokeWidth={1.5}
            />
            <Line
              type="monotone"
              dataKey="portfolio"
              name="Portfolio"
              stroke="var(--primary)"
              dot={false}
              strokeWidth={2}
            />
            {hasAlternative && (
              <Line
                type="monotone"
                dataKey="alternative"
                name="Alternative"
                stroke="var(--seg-2)"
                dot={false}
                strokeWidth={2}
              />
            )}
            {/* 🎉 dot where each scenario first crosses its goal */}
            {scenarios.map((s) => {
              if (s.achievedYear == null) return null;
              const point = data.find((d) => d.year === s.achievedYear);
              const y = s.id === "portfolio" ? point?.portfolio : point?.alternative;
              if (point == null || y == null) return null;
              return (
                <ReferenceDot
                  key={s.id}
                  x={s.achievedYear}
                  y={y}
                  r={4}
                  fill={s.id === "portfolio" ? "var(--primary)" : "var(--seg-2)"}
                  stroke="var(--card)"
                  strokeWidth={2}
                  label={{ value: "🎉", position: "top", fontSize: 12 }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
