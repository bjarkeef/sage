import * as React from "react";
import { cn } from "../../lib/utils";

export interface SectionHeaderProps {
  title: string;
  /** Right-aligned muted meta (counts, links, chips). */
  meta?: React.ReactNode;
  className?: string;
}

/** Page-section heading: quiet sans instead of shouting caps. */
export function SectionHeader({ title, meta, className }: SectionHeaderProps) {
  return (
    <div className={cn("mb-4 flex items-baseline justify-between gap-4", className)}>
      <h2 className="text-sm font-semibold tracking-[-0.01em]">{title}</h2>
      {meta != null && <div className="text-xs text-muted-foreground">{meta}</div>}
    </div>
  );
}
