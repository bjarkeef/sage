import * as React from "react";
import { cn } from "../../lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Dense surfaces (bento tiles) — 20px padding instead of 24px. */
  compact?: boolean;
}

/** Surface shell: white-alpha wash + hairline. Depth by layering, never shadow. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, compact, ...props }, ref) => (
    <div
      ref={ref}
      data-card=""
      className={cn(
        "rounded-card border border-hairline bg-surface-card text-card-foreground",
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
