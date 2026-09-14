import * as React from "react";
import { cn } from "../../lib/utils";

/** No borders: a callout sits IN the page flow, so it is a surface like any
 *  other and takes its edge from its wash (DESIGN.md §1). Borders are for
 *  things that float over arbitrary content — `Popover`, `Dialog`, `Toast`.
 *  The tinted tones already carry a 10% fill, which reads on its own. */
const toneClass = {
  info: "bg-surface-card text-foreground",
  error: "bg-destructive/10 text-destructive",
  success: "bg-gain/10 text-gain",
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
      className={cn("rounded-card px-4 py-3 text-sm", toneClass[tone], className)}
      {...props}
    />
  );
}
