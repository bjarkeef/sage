import * as React from "react";
import { cn } from "../../lib/utils";

const sizeClass = {
  hero: "hero-num",
  md: "stat-num",
  sm: "font-display text-xl font-light tracking-[-0.01em] tabular-nums",
} as const;

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  /** Muted secondary line under the value (Snowball's context pairing). */
  context?: React.ReactNode;
  size?: keyof typeof sizeClass;
}

export function Stat({ label, value, context, size = "md", className, ...props }: StatProps) {
  return (
    <div className={cn("min-w-0", className)} {...props}>
      <div className="label-caps text-muted-foreground">{label}</div>
      <div className={cn("mt-1.5", sizeClass[size])}>{value}</div>
      {context != null && <div className="mt-1 text-xs text-muted-foreground">{context}</div>}
    </div>
  );
}

/** Boxless stat row: cells separated by faint hairlines, no tiles. */
export function StatStrip({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid auto-cols-fr grid-flow-col divide-x divide-hairline-faint",
        "[&>*]:px-6 [&>*]:py-1 [&>*:first-child]:pl-0 [&>*:last-child]:pr-0",
        className,
      )}
      {...props}
    />
  );
}
