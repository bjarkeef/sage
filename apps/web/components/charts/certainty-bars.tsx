"use client";

/** Shared certainty vocabulary for the dividend BAR charts (the analytics
 *  "Next 12 months" forward chart and the /dividends income bars).
 *
 *  Bars use one hue at three weights — but *filled* (not outlined), because a
 *  forward-heavy chart is mostly "estimated" and faint outlines are unreadable
 *  at bar scale. Paid strongest → estimated faintest. (The small status
 *  chips/badges on the calendar keep the outline convention; these fills are
 *  for bars only.) */

export type Cert = "paid" | "confirmed" | "estimated";

export const CERTAINTY_FILL: Record<Cert, string> = {
  paid: "color-mix(in srgb, var(--primary) 90%, transparent)",
  confirmed: "color-mix(in srgb, var(--primary) 52%, transparent)",
  estimated: "color-mix(in srgb, var(--primary) 24%, transparent)",
};

const LEGEND: readonly (readonly [Cert, string])[] = [
  ["paid", "Paid"],
  ["confirmed", "Confirmed"],
  ["estimated", "Estimated"],
];

/** Filled legend matching {@link CERTAINTY_FILL}, shared by both bar charts so
 *  their swatches can't drift from their bars. */
export function CertaintyBarsLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LEGEND.map(([key, name]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <i
            className="h-2.5 w-2.5 rounded-badge"
            style={{
              background: CERTAINTY_FILL[key],
              ...(key === "estimated"
                ? { border: "1px dashed var(--certainty-estimated-border)" }
                : null),
            }}
          />
          {name}
        </span>
      ))}
      <span className="font-mono">~ estimated date</span>
    </div>
  );
}
