import * as React from "react";
import { cn } from "../../lib/utils";

/** `primary` is emphasis by WEIGHT, not by hue: a brighter wash and full-strength
 *  text against `neutral`'s muted pair. It used to be `bg-primary/10
 *  text-primary`, which put the brand accent on status badges — "In portfolio",
 *  "Corrected" — and chrome is the one place DESIGN.md §1 says the accent may
 *  never go. Every call site's intent (this one matters more than that one)
 *  survives the change; only the colour does not. gain/loss/income stay hued
 *  because those three carry a meaning colour is the fastest way to read. */
const toneClass = {
  neutral: "bg-surface-active text-muted-foreground",
  primary: "bg-foreground/10 text-foreground",
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
