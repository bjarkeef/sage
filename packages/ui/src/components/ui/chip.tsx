import * as React from "react";
import { cn } from "../../lib/utils";

const toneClass = {
  neutral: "bg-surface-active text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  gain: "bg-gain/12 text-gain",
  loss: "bg-loss/12 text-loss",
  income: "bg-income/12 text-income",
} as const;

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof toneClass;
  /** "outline" = hairline border, no wash (quiet secondary badges). */
  variant?: "wash" | "outline";
}

export function Chip({ tone = "neutral", variant = "wash", className, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-badge px-1.5 py-0.5 label-caps",
        variant === "outline" ? "border border-hairline text-muted-foreground" : toneClass[tone],
        className,
      )}
      {...props}
    />
  );
}
