"use client";

import * as React from "react";

/** Recharts injects `active`, `payload`, and `label` when it clones the
 *  element passed to a `<Tooltip content=... />`. Any extra props we set on
 *  that element (formatters, hideLabel) are preserved through the clone, so a
 *  single themed tooltip serves every chart. */
export interface ChartTooltipProps {
  active?: boolean;
  /** Recharts payload entries for the hovered point. */
  payload?: Array<{
    name?: string | number;
    value?: number | string;
    color?: string;
    fill?: string;
    dataKey?: string | number;
    payload?: Record<string, unknown>;
  }>;
  label?: string | number;
  /** Format the header line (defaults to the raw category label). */
  labelFormatter?: (
    label: unknown,
    payload: NonNullable<ChartTooltipProps["payload"]>,
  ) => React.ReactNode;
  /** Format each row's value (defaults to the raw value). */
  valueFormatter?: (
    value: unknown,
    entry: NonNullable<ChartTooltipProps["payload"]>[number],
  ) => React.ReactNode;
  /** Hide the per-row series name (for single-series charts). */
  hideName?: boolean;
  /** Drop rows whose value is 0 (e.g. empty series in a stacked bar). */
  skipZero?: boolean;
}

/** A calm, Sage-token tooltip card shared by every Recharts chart — a hairline
 *  border, popover surface, caps label, mono tabular values. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  hideName,
  skipZero,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = skipZero ? payload.filter((e) => Number(e.value) !== 0) : payload;
  if (rows.length === 0) return null;

  return (
    <div className="min-w-[8rem] rounded-control border border-hairline bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md">
      <div className="mb-1 label-caps text-muted-foreground">
        {labelFormatter ? labelFormatter(label, rows) : label}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((entry, i) => (
          <div key={entry.dataKey ?? i} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 flex-none rounded-full"
              style={{ background: entry.color ?? entry.fill ?? "var(--income)" }}
            />
            {!hideName && entry.name != null && (
              <span className="text-muted-foreground">{entry.name}</span>
            )}
            <span className="ml-auto font-mono tabular-nums text-foreground">
              {valueFormatter ? valueFormatter(entry.value, entry) : String(entry.value ?? "")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
