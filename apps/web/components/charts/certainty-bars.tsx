"use client";

/** Shared certainty vocabulary for the dividend BAR charts (the analytics
 *  "Next 12 months" forward chart and the /dividends income bars).
 *
 *  Bars used to be one hue (`--primary`) at three alpha steps, filled rather
 *  than outlined, on the reasoning that a forward-heavy chart is mostly
 *  "estimated" and faint outlines are unreadable at bar scale. Measured
 *  against the dark card that ramp failed: adjacent steps landed at ΔE 14.2
 *  (below the 15 floor for normal colour vision — the top and middle fill
 *  were barely distinguishable) and the faintest step at 1.47:1 contrast
 *  against the card (effectively invisible, well under the 3:1 floor).
 *
 *  The fills now come from a dedicated `--certainty-*` ramp (gold, this file's
 *  reserved income hue, stepped in lightness rather than alpha) that clears
 *  both checks. That ramp still leaves the faintest, most common step — most
 *  of a forward-looking chart is "estimated" — hard to read as its own
 *  segment on a small bar, so estimated additionally carries an outline
 *  (`CERTAINTY_STROKE`) over a deliberately faint fill: the outline is what
 *  makes the segment legible, not the fill. Paid and confirmed stay solid,
 *  unoutlined fills. (The small status chips/badges on the calendar keep
 *  their own separate outline convention and their own tokens — untouched
 *  here.) */

export type Cert = "paid" | "confirmed" | "estimated";

export const CERTAINTY_FILL: Record<Cert, string> = {
  paid: "var(--certainty-paid)",
  confirmed: "var(--certainty-confirmed)",
  estimated: "var(--certainty-estimated-fill)",
};

/** Estimated bars carry an outline as well as a fill — the fill alone is
 *  deliberately faint so a forward-heavy chart does not read as a wall of
 *  solid colour, and the outline is what makes the segment legible. */
export const CERTAINTY_STROKE: Partial<Record<Cert, string>> = {
  estimated: "var(--certainty-estimated)",
};

const LEGEND: readonly (readonly [Cert, string])[] = [
  ["paid", "Paid"],
  ["confirmed", "Confirmed"],
  ["estimated", "Estimated"],
];

/** Legend matching {@link CERTAINTY_FILL} and {@link CERTAINTY_STROKE}, shared
 *  by both bar charts so their swatches can't drift from their bars. */
export function CertaintyBarsLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LEGEND.map(([key, name]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <i
            className="h-2.5 w-2.5 rounded-badge"
            style={{
              background: CERTAINTY_FILL[key],
              ...(CERTAINTY_STROKE[key] ? { border: `1px dashed ${CERTAINTY_STROKE[key]}` } : null),
            }}
          />
          {name}
        </span>
      ))}
      <span className="font-mono">~ estimated date</span>
    </div>
  );
}
