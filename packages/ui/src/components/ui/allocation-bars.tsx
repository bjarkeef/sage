import * as React from "react";
import { cn } from "../../lib/utils";

/* The one categorical ramp — see DESIGN.md §1. `--seg-rest` is the shared tail:
   past the ramp every row gets it, so "the others" reads as one group. */
const SEGMENT_COLORS = [
  "var(--seg-1)",
  "var(--seg-2)",
  "var(--seg-3)",
  "var(--seg-4)",
  "var(--seg-5)",
  "var(--seg-6)",
  "var(--seg-7)",
  "var(--seg-rest)",
] as const;

export interface AllocationRow {
  label: string;
  /** 0–100 */
  percent: number;
  /** Optional formatted money, shown muted before the percent. */
  value?: string;
}

export interface AllocationBarsProps {
  title: string;
  rows: AllocationRow[];
  /** Overflow beyond maxRows − 1 collapses into an "Other" row. */
  maxRows?: number;
  /** "bar" renders one segmented bar with a dot legend. */
  variant?: "rows" | "bar";
  /** Skip the internal heading — use when a wrapping card already renders a CardTitle.
   *  `title` is still required: it feeds the `role="img"` aria-label. */
  hideTitle?: boolean;
  className?: string;
}

export function AllocationBars({
  title,
  rows,
  maxRows = 8,
  variant = "rows",
  hideTitle,
  className,
}: AllocationBarsProps) {
  const segmentColor = (i: number) => SEGMENT_COLORS[Math.min(i, SEGMENT_COLORS.length - 1)]!;
  const display = React.useMemo<AllocationRow[]>(() => {
    const sorted = [...rows].sort((a, b) => b.percent - a.percent);
    if (sorted.length <= maxRows) return sorted;
    const top = sorted.slice(0, maxRows - 1);
    const rest = sorted.slice(maxRows - 1);
    return [...top, { label: "Other", percent: rest.reduce((sum, r) => sum + r.percent, 0) }];
  }, [rows, maxRows]);

  if (variant === "bar") {
    const ariaLabel = `${title}: ${display
      .map((r) => `${r.label} ${r.percent.toFixed(1)}%`)
      .join(", ")}`;
    return (
      <div className={cn("space-y-3", className)}>
        {!hideTitle && <h3 className="label-caps text-muted-foreground">{title}</h3>}
        <div
          role="img"
          aria-label={ariaLabel}
          className="flex h-2.5 gap-[2px] overflow-hidden rounded-full"
        >
          {display.map((row, i) => (
            <div
              key={row.label}
              className="h-full"
              style={{
                width: `${Math.min(Math.max(row.percent, 0), 100)}%`,
                background: segmentColor(i),
              }}
            />
          ))}
        </div>
        {/* The track floor has to cover what the row actually holds.
            `auto-fit` packs in as many columns as the floor allows and then
            stretches them, so a floor that is too low does not overflow — it
            silently compresses every cell, and `min-w-0 truncate` on the label
            turns that into clipped text rather than a visible break.
            190px fits `[dot] [label] [%]`. It does not fit the money column
            that `value` adds: on /diversification's full-width cards that
            packed five columns into 1072px and left the label 25px, rendering
            "VanEck Morningstar Developed Markets…" as "Van…". With a value
            present the floor rises to 300px, which packs three and leaves the
            label ~170px. */}
        <div
          className={cn(
            "grid gap-x-6 gap-y-0.5",
            display.some((row) => row.value)
              ? "grid-cols-[repeat(auto-fit,minmax(300px,1fr))]"
              : "grid-cols-[repeat(auto-fit,minmax(190px,1fr))]",
          )}
        >
          {display.map((row, i) => (
            <div
              key={row.label}
              className="flex items-center gap-2.5 rounded-control px-1.5 py-1.5 transition-colors hover:bg-surface-hover"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: segmentColor(i) }}
              />
              <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
              {row.value && <span className="text-xs text-muted-foreground">{row.value}</span>}
              <span className="font-mono text-data tabular-nums text-muted-foreground">
                {row.percent.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {!hideTitle && <h3 className="label-caps text-muted-foreground">{title}</h3>}
      <div className="space-y-2.5">
        {display.map((row) => (
          <div key={row.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm">{row.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                {row.value && <span className="text-xs text-muted-foreground">{row.value}</span>}
                <span className="font-mono text-data tabular-nums">{row.percent.toFixed(1)}%</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(Math.max(row.percent, 0), 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
