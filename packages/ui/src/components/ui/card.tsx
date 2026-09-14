import * as React from "react";
import { cn } from "../../lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Dense surfaces (bento tiles) — 20px padding instead of 24px. */
  compact?: boolean;
}

/** Surface shell: a white-alpha wash and nothing else. Depth by layering, never
 *  a border and never a shadow.
 *
 *  The border is deliberately absent. With `--surface-card` at 0.015 and
 *  `--hairline` at 0.07 the outline was ~4.7x the fill it enclosed, so cards
 *  read as empty boxes ruled onto the ground rather than as raised surfaces —
 *  the opposite of what DESIGN.md §1 asks for, and the single biggest reason
 *  the app looked boxy next to Fey. The fix is one token up and one class off:
 *  the wash now carries the edge by itself. Do not re-add `border-hairline`
 *  here; if two adjacent cards need separating, that is a gap, not a rule. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, compact, ...props }, ref) => (
    <div
      ref={ref}
      data-card=""
      className={cn(
        "rounded-card bg-surface-card text-card-foreground",
        compact ? "p-5" : "p-6",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Right-aligned muted meta (counts, totals, chips). */
  meta?: React.ReactNode;
}

export function CardTitle({ meta, className, children, ...props }: CardTitleProps) {
  return (
    <div className={cn("mb-3.5 flex items-baseline justify-between gap-3", className)}>
      <h3 className="text-sm font-medium" {...props}>
        {children}
      </h3>
      {meta != null && <div className="text-xs text-muted-foreground">{meta}</div>}
    </div>
  );
}
