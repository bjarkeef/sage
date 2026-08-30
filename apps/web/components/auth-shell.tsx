import type { ReactNode } from "react";
import { Card, SageMark } from "@sage/ui";

/**
 * Shared frame for sign-in and sign-up.
 *
 * These are the only two pages a person sees before they trust Sage with a
 * ledger, and the only two outside `PageShell` — so the brand is stated once,
 * quietly, rather than left to a bare mark floating over two inputs.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  /** One line under the title — what this page is for, not marketing. */
  subtitle?: string;
  children: ReactNode;
  /** Muted note under the card: instance-level facts worth knowing before
   *  signing in (how recovery works, whether registration is open). */
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="fade-up w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-4 text-center">
          <span className="flex items-center gap-2">
            <SageMark size={22} color="var(--foreground)" accent="var(--primary)" />
            <span className="font-display text-base font-medium tracking-[-0.02em]">Sage</span>
          </span>
          <span>
            <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          </span>
        </div>

        <Card>{children}</Card>

        {footer && (
          <div className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
            {footer}
          </div>
        )}
      </div>
    </main>
  );
}
