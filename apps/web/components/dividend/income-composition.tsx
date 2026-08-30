"use client";

import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardTitle, SegmentedControl } from "@sage/ui";
import type { DividendIncomeDTO, IncomeGroupRow } from "../../lib/types";
import { ActArrow } from "./kpi-cards";
import { ChartTooltip } from "../charts/chart-tooltip";
import { CURSOR_FILL, segColor } from "../charts/chart-theme";

type Group = "holdings" | "sector" | "currency";

const GROUP_TABS: { value: Group; label: string }[] = [
  { value: "holdings", label: "Holdings" },
  { value: "sector", label: "Sector" },
  { value: "currency", label: "Currency" },
];

/** Cap the legend at this many named rows; any remainder rolls into a
 *  single "N others" row so a long tail of tiny holdings doesn't blow out
 *  the card. The API already sorts each group desc by amount. */
const MAX_VISIBLE_ROWS = 7;

interface DisplayRow {
  label: string;
  share: number;
}

function toDisplayRows(rows: IncomeGroupRow[]): DisplayRow[] {
  if (rows.length <= MAX_VISIBLE_ROWS) {
    return rows.map((r) => ({ label: r.label, share: r.share }));
  }
  const visible = rows.slice(0, MAX_VISIBLE_ROWS).map((r) => ({ label: r.label, share: r.share }));
  const rest = rows.slice(MAX_VISIBLE_ROWS);
  const restShare = rest.reduce((sum, r) => sum + r.share, 0);
  const restLabel = `${rest.length} other${rest.length === 1 ? "" : "s"}`;
  return [...visible, { label: restLabel, share: restShare }];
}

function formatShare(share: number): string {
  // One decimal max, but drop a trailing ".0" so whole percents read "34%"
  // not "34.0%" (matches the mockup's locale-style legend).
  const v = Math.round(share * 1000) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

export function IncomeComposition({ groups }: { groups: DividendIncomeDTO["incomeByGroup"] }) {
  const [group, setGroup] = React.useState<Group>("holdings");

  const rows = React.useMemo(() => toDisplayRows(groups[group]), [groups, group]);

  return (
    <Card
      compact
      className="group relative flex h-full flex-col transition-colors hover:bg-surface-hover/60"
    >
      <ActArrow />

      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div>
          <CardTitle className="mb-0">Income composition</CardTitle>
          <div className="text-xs text-muted-foreground">Share of annual income</div>
        </div>
        <SegmentedControl
          options={GROUP_TABS}
          value={group}
          onChange={(v) => setGroup(v as Group)}
          size="sm"
          className="flex-none"
        />
      </div>

      <div className="flex flex-1 items-center gap-5">
        <div data-testid="income-composition-donut" className="h-[156px] w-[156px] flex-none">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip
                cursor={{ fill: CURSOR_FILL }}
                content={
                  <ChartTooltip
                    hideName
                    labelFormatter={(_label, payload) => String(payload?.[0]?.name ?? "")}
                    valueFormatter={(value) => formatShare(Number(value))}
                  />
                }
              />
              <Pie
                data={rows}
                dataKey="share"
                nameKey="label"
                innerRadius={50}
                outerRadius={76}
                startAngle={90}
                endAngle={-270}
                paddingAngle={1}
                stroke="var(--card)"
                strokeWidth={2}
              >
                {rows.map((r, i) => (
                  <Cell key={r.label} fill={segColor(i)} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {rows.map((r, i) => (
            <div key={r.label} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{ background: segColor(i) }}
              />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatShare(r.share)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
