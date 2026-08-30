import { cn } from "../../lib/utils";

/** Shimmer placeholder block. Size it with className; shape defaults to rounded-control. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-control", className)} />;
}
