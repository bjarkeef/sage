import { cn } from "../../lib/utils";
import { Skeleton } from "./skeleton";

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading chart" className={cn("w-full", className)}>
      <Skeleton className="h-60 w-full rounded-card" />
    </div>
  );
}
