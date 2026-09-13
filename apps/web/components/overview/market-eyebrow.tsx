"use client";

import { useEffect, useState } from "react";
import { marketState } from "../../lib/brief";

const LABEL: Record<ReturnType<typeof marketState>, string> = {
  open: "markets open",
  preOpen: "markets open later",
  closed: "markets closed",
  weekend: "markets closed",
};

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The day and whether anything is trading, in mono caps above the figure.
 *
 * Mount-gated for the same reason `BriefHeader`'s market subline is: the state
 * is computed from a clock, and the server's clock and the reader's are not the
 * same one. Server output and first client render are an empty element of the
 * right height, so a mismatch is impossible by construction rather than patched
 * over with suppressHydrationWarning.
 */
export function MarketEyebrow() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const now = new Date();
  const state = marketState(now);

  return (
    <p className="label-caps flex min-h-4 items-center gap-2 text-muted-foreground">
      {mounted && (
        <>
          <span
            aria-hidden
            className={`h-1.5 w-1.5 flex-none rounded-full ${
              state === "open" ? "bg-gain motion-safe:animate-pulse" : "bg-muted-foreground/50"
            }`}
          />
          {`${DAY[now.getDay()]} · ${LABEL[state]}`}
        </>
      )}
    </p>
  );
}
