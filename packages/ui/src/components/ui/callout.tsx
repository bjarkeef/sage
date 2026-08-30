import * as React from "react";
import { cn } from "../../lib/utils";

const toneClass = {
  info: "border-hairline bg-surface-card text-foreground",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-gain/30 bg-gain/10 text-gain",
} as const;

export interface CalloutProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: keyof typeof toneClass;
}

/** Inline banner for statuses inside a page flow (import errors/success,
 *  inline warnings). For full-section failures use ErrorState instead. */
export function Callout({ tone = "info", className, ...props }: CalloutProps) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn("rounded-card border px-4 py-3 text-sm", toneClass[tone], className)}
      {...props}
    />
  );
}
