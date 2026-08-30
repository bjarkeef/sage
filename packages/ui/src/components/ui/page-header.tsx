import * as React from "react";
import { cn } from "../../lib/utils";

export interface PageHeaderProps {
  title: string;
  /**
   * Sub-title line under the title. A plain string renders as muted text; pass
   * a `React.ReactNode` (e.g. a component with a link) when the sub-title
   * needs richer markup. Wrapped in a `<div>` rather than a `<p>` so a caller
   * that needs its own `<p>` (or other block content) inside can nest one
   * without producing invalid `<p>`-in-`<p>` markup.
   */
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    // Wraps at every level. `shrink-0` on the actions is right on a desktop —
    // controls should not be squeezed — but on a phone it made the group a
    // rigid 434px inside a 360px column, so the page scrolled sideways. The
    // title block gets `min-w-0` so a long title truncates instead of pushing
    // the actions out, and the actions themselves wrap rather than refusing to.
    <div className={cn("mb-8 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-title font-semibold tracking-[-0.03em]">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3 sm:shrink-0">{actions}</div>}
    </div>
  );
}
