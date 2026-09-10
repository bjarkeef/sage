"use client";

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
import type { DividendPerHoldingDTO } from "../../lib/types";
import { ChartTooltip } from "../charts/chart-tooltip";
import { AXIS_TICK, CURSOR_FILL, GRID_STROKE, LABEL_STYLE } from "../charts/chart-theme";

/** A leaderboard, not a full ledger — show the fastest growers only (the
 *  holdings table carries every holding's CAGR). Keeps the card a compact,
 *  balanced height instead of a 20-row column. */
const MAX_ROWS = 8;

interface GrowthRow {
  symbol: string;
  pct: number; // signed percentage, e.g. 24 or -4
}

/** Pure row shaping (exported for unit tests — the Recharts SVG doesn't lay
 *  out under jsdom, so logic is tested here rather than through the DOM). */
export function topGrowth(perHolding: DividendPerHoldingDTO[]): GrowthRow[] {
  return perHolding
    .filter((h): h is DividendPerHoldingDTO & { cagr5y: string } => h.cagr5y != null)
    .map((h) => ({ symbol: h.symbol, pct: Number(h.cagr5y) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, MAX_ROWS);
}

function signedPct(pct: number): string {
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`;
}

/** Horizontal bars of 5-yr dividend CAGR, top growers first; holdings without
 *  a CAGR are omitted (not "—" rows). Capped to the fastest {@link MAX_ROWS}. */
export function GrowthLeaders({ perHolding }: { perHolding: DividendPerHoldingDTO[] }) {
  const rows = topGrowth(perHolding);
  if (rows.length === 0) return null;
  const min = Math.min(0, ...rows.map((r) => r.pct));
  const max = Math.max(0, ...rows.map((r) => r.pct));

  return (
    <Card compact className="relative flex h-full flex-col">
      <div className="mb-3.5">
        <CardTitle className="mb-0">Dividend growth</CardTitle>
        <div className="text-xs text-muted-foreground">Fastest dividend growers, 5-yr CAGR</div>
      </div>

      <div className="flex-1" style={{ minHeight: rows.length * 30 + 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={rows}
            margin={{ top: 0, right: 46, left: 0, bottom: 0 }}
            barCategoryGap={6}
          >
            <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
            <XAxis type="number" hide domain={[min, max]} />
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
                <ChartTooltip hideName valueFormatter={(value) => signedPct(Number(value))} />
              }
            />
            <Bar dataKey="pct" radius={[2, 4, 4, 2]} maxBarSize={16}>
              {rows.map((r) => (
                <Cell key={r.symbol} fill={r.pct >= 0 ? "var(--gain)" : "var(--loss)"} />
              ))}
              <LabelList
                dataKey="pct"
                position="right"
                style={LABEL_STYLE}
                formatter={(value) => (value == null ? "" : signedPct(Number(value)))}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
