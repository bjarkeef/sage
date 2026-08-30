import * as React from "react";
import { cn } from "../../lib/utils";

export interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** "narrow" is for focused single-column pages (Settings). */
  width?: "default" | "narrow";
}

/** Centered page container — the app-wide content column. */
export function PageShell({ width = "default", className, ...props }: PageShellProps) {
  return (
    <div
      className={cn(
        // 32px each side is 17% of a 375px phone spent on margin, which is
        // most of why the app felt cramped there. Half it below sm and give
        // the content back; the desktop rhythm is unchanged from sm up.
        "mx-auto w-full px-4 sm:px-8",
        width === "narrow" ? "max-w-narrow" : "max-w-page",
        className,
      )}
      {...props}
    />
  );
}
