"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BasisChip, Card, CardTitle } from "@sage/ui";
import type { YieldByHoldingRow } from "../../lib/dividend-derive";
import { ActArrow } from "./kpi-cards";
import { ChartTooltip } from "../charts/chart-tooltip";
import { AXIS_TICK, CURSOR_FILL, GRID_STROKE, LABEL_STYLE } from "../charts/chart-theme";

/** Top yielders only — the holdings table lists everyone; this card is a
 *  compact highlight, kept balanced with its bento neighbours. */
const MAX_ROWS = 8;

/** Pure row shaping (exported for unit tests — the Recharts SVG doesn't lay
 *  out under jsdom, so logic is tested here rather than through the DOM). */
export function topYields(rows: YieldByHoldingRow[]): YieldByHoldingRow[] {
  return rows.slice(0, MAX_ROWS);
}

/** Horizontal gold (income accent) bars — forward yield per holding,
 *  descending. Rows are already derived/sorted by `yieldByHolding`. */
export function YieldByHolding({
  rows,
  taxed = false,
}: {
  rows: YieldByHoldingRow[];
  /** Whether `currentYield` below divides a tax-netted forward income by
   *  market value — drives the `BasisChip` in the title row. The figure is
   *  a percentage, not money, but its numerator is scaled by the same
   *  factor as every other card on this page, so the same basis marker
   *  applies. Optional so this component's own unit tests (which don't
   *  exercise tax) don't need to thread it; the real caller
   *  (`/dividends/analytics`) always passes it explicitly. */
  taxed?: boolean;
}) {
  if (rows.length === 0) return null;
  const shown = topYields(rows);

  return (
    <Card
      compact
      className="group relative flex h-full flex-col transition-colors hover:bg-surface-hover/60"
    >
      <ActArrow />
      <div className="mb-3.5">
        <CardTitle className="mb-0" meta={<BasisChip taxed={taxed} />}>
          Yield by holding
        </CardTitle>
        <div className="text-xs text-muted-foreground">Forward yield on current price</div>
      </div>

      <div className="flex-1" style={{ minHeight: shown.length * 30 + 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={shown}
            margin={{ top: 0, right: 46, left: 0, bottom: 0 }}
            barCategoryGap={6}
          >
            <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="symbol"
              width={56}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
            />
            <Tooltip
              cursor={{ fill: CURSOR_FILL }}
              content={
                <ChartTooltip hideName valueFormatter={(value) => `${Number(value).toFixed(1)}%`} />
              }
            />
            <Bar dataKey="currentYield" fill="var(--income)" radius={[2, 4, 4, 2]} maxBarSize={16}>
              <LabelList
                dataKey="currentYield"
                position="right"
                style={LABEL_STYLE}
                formatter={(value) => (value == null ? "" : `${Number(value).toFixed(1)}%`)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
