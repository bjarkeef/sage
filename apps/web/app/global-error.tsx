"use client";

import "./globals.css";
import { SageMark } from "@sage/ui";

/** Replaces the root layout when it crashes, so it must carry its own <html>,
 *  stylesheet import, and stay free of app providers. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <div className="flex flex-col items-center text-center">
          <SageMark size={28} className="text-muted-foreground" />
          <span className="mt-6 label-caps text-muted-foreground">Error</span>
          <h1 className="mt-2 font-display text-title font-semibold tracking-[-0.03em]">
            Something went wrong
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">{error.message}</p>
          <button
            onClick={reset}
            className="mt-6 rounded-full border border-hairline px-5 py-2 text-sm font-medium transition-colors hover:bg-surface-hover"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
