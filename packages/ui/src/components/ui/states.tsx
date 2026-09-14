import * as React from "react";
import { cn } from "../../lib/utils";
import { Button } from "./button";

export interface EmptyStateProps {
  /** One plain sentence. Sections with nothing to say should render nothing instead. */
  message: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ message, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center gap-3 py-10 text-center", className)}
    >
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-card bg-surface-card px-6 py-10 text-center",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
