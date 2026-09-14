"use client";

import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { timeOfDay } from "./greeting";
import { marketState, marketStateLine, type BriefSegment } from "../lib/brief";

const TONE_CLASS: Record<"gain" | "loss" | "income" | "neutral", string> = {
  gain: "text-gain",
  loss: "text-loss",
  income: "text-income",
  neutral: "",
};

function renderSegments(segments: BriefSegment[]) {
  return segments.map((seg, i) =>
    seg.kind === "text" ? (
      seg.text
    ) : (
      <span key={i} className={`font-medium tabular-nums text-foreground ${TONE_CLASS[seg.tone]}`}>
        {seg.text}
      </span>
    ),
  );
}

interface BriefHeaderProps {
  segments: BriefSegment[];
  marketStateEnabled: boolean;
  todayChangePercent: number | null;
  /** "inline" is the overview's: one paragraph, greeting first at full strength
   *  and the day's line after it in muted — set beneath the figure rather than
   *  above it, with no market subline, because the market state has moved to the
   *  eyebrow over the figure where it is one glance rather than a third line. */
  layout?: "stacked" | "inline";
}

/** The overview header: a time-of-day greeting (same hydration-safe pattern
 *  as the shipped Greeting) plus an optional composed segment paragraph
 *  (`composeBrief` or the figure-free `composeColorLine`, per caller), with
 *  an optional market-state subline — independent of whether segments are
 *  supplied.
 *
 *  The subline is mount-gated: `marketStateLine` can return multiple children
 *  (text + toned span + text in the closed state), which
 *  suppressHydrationWarning cannot patch if server and client compute
 *  different states from their clocks. Server output and first client render
 *  are both an empty <p> (height reserved), so a mismatch is impossible by
 *  construction; the content appears after mount. */
export function BriefHeader({
  segments,
  marketStateEnabled,
  todayChangePercent,
  layout = "stacked",
}: BriefHeaderProps) {
  const { data: session } = authClient.useSession();
  const first = session?.user?.name?.trim().split(/\s+/)[0];
  const greeting = timeOfDay(new Date().getHours());

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (layout === "inline") {
    // No greeting. "Good evening, Sage." is a greeting used as information,
    // which is on this app's own rejected list — the hour is already in the
    // eyebrow two lines above, and the slot is the only one on the page that
    // can carry something real. The grammar here is what moved, then what is
    // coming; `composeColorLine` already composes exactly that.
    if (segments.length === 0) return null;
    return (
      <p className="max-w-[54ch] text-lg/relaxed font-light text-muted-foreground text-balance">
        {renderSegments(segments)}
      </p>
    );
  }

  return (
    <div>
      <h1 className="text-title font-normal" suppressHydrationWarning>
        {`${greeting}${first ? `, ${first}` : ""}`}
      </h1>
      {segments.length > 0 && (
        <p className="max-w-[58ch] text-lg/relaxed font-light text-muted-foreground">
          {renderSegments(segments)}
        </p>
      )}
      {marketStateEnabled && (
        <p className="mt-2 min-h-5 text-sm text-muted-foreground/70">
          {mounted &&
            renderSegments(
              marketStateLine(
                marketState(new Date()),
                todayChangePercent != null ? { percent: todayChangePercent } : null,
              ),
            )}
        </p>
      )}
    </div>
  );
}
