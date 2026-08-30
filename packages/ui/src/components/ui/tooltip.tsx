"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import { cn } from "../../lib/utils";

/**
 * A small ⓘ trigger that reveals a brief explanation in a compact popover.
 * Click/tap-triggered rather than hover-only, so it works on touch devices —
 * built on the existing Popover primitive instead of a new Radix dependency.
 */
export function InfoTooltip({
  label,
  children,
  className,
}: {
  /** Accessible name for the trigger button, e.g. "About this figure". */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-64 p-3 text-xs text-muted-foreground", className)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}
