import * as React from "react";
import { cn } from "../../lib/utils";

export interface RowGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** grid-template-columns track list, shared by header + all rows. */
  columns: string;
}

/** Fixed-track row list — the readable-row contract's shared column grid. */
export function RowGrid({ columns, className, style, ...props }: RowGridProps) {
  return (
    <div
      role="table"
      style={{ ...style, "--row-grid": columns } as React.CSSProperties}
      className={cn("w-full", className)}
      {...props}
    />
  );
}

const rowTracks = "grid items-center gap-3 [grid-template-columns:var(--row-grid)]";

export interface RowHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  cells: React.ReactNode[];
  align?: ("left" | "right")[];
}

export function RowHeader({ cells, align, className, ...props }: RowHeaderProps) {
  return (
    <div role="row" className={cn(rowTracks, "px-3 pb-2", className)} {...props}>
      {cells.map((cell, i) => (
        <div
          key={i}
          role="columnheader"
          className={cn(
            "label-caps text-muted-foreground",
            (align?.[i] ?? (i > 0 ? "right" : "left")) === "right" && "text-right",
          )}
        >
          {cell}
        </div>
      ))}
    </div>
  );
}

export function DataRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="row"
      className={cn(
        rowTracks,
        "min-h-11 rounded-control px-3 transition-colors hover:bg-surface-hover",
        className,
      )}
      {...props}
    />
  );
}

export interface RowCellProps extends React.HTMLAttributes<HTMLDivElement> {
  primary: React.ReactNode;
  /** Muted context line under the primary (readable-row contract). */
  secondary?: React.ReactNode;
  align?: "left" | "right";
  /** "figure" (default) = mono tabular; "text" = sans medium (identity cells). */
  variant?: "figure" | "text";
}

export function RowCell({
  primary,
  secondary,
  align = "left",
  variant = "figure",
  className,
  ...props
}: RowCellProps) {
  return (
    <div
      role="cell"
      className={cn("min-w-0", align === "right" && "text-right", className)}
      {...props}
    >
      <div
        className={cn(
          "truncate",
          variant === "figure" ? "font-mono text-data tabular-nums" : "text-sm font-medium",
        )}
      >
        {primary}
      </div>
      {secondary != null && (
        <div className="truncate text-xs text-muted-foreground">{secondary}</div>
      )}
    </div>
  );
}
