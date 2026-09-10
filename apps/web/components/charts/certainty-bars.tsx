"use client";

/** Shared certainty vocabulary for the dividend BAR charts (the analytics
 *  "Next 12 months" forward chart and the /dividends income bars).
 *
 *  Bars are one hue (`--primary`) — no, one hue reserved for this vocabulary
 *  (gold, this file's reserved income hue) — stepped in lightness across
 *  three solid, unoutlined fills, rather than alpha: alpha steps failed here.
 *  Measured against the dark card, an earlier alpha ramp put adjacent steps
 *  at ΔE 14.2 (below the 15 floor for normal colour vision — the top and
 *  middle fill were barely distinguishable) and the faintest step at 1.47:1
 *  contrast against the card (effectively invisible, well under the 3:1
 *  floor). The `--certainty-*` lightness ramp clears both checks (ΔE 16.1
 *  measured between adjacent steps).
 *
 *  A later revision made `estimated` a faint fill plus a dashed outline, on
 *  the reasoning that the faintest, most common step — most of a
 *  forward-looking chart is "estimated" — needed the outline to read as its
 *  own segment. That held up in a mockup with a handful of wide bars, but at
 *  real bar scale (twelve thin bars in the forward window) it made the chart
 *  read as a row of near-empty dashed boxes — worse than the ramp it
 *  replaced. `estimated` is solid again, same as paid and confirmed; the ΔE
 *  16.1 separation holds on the fill alone. (The small status chips/badges on
 *  the calendar keep their own separate outline convention and their own
 *  tokens — untouched here.) */

export type Cert = "paid" | "confirmed" | "estimated";

export const CERTAINTY_FILL: Record<Cert, string> = {
  paid: "var(--certainty-paid)",
  confirmed: "var(--certainty-confirmed)",
  estimated: "var(--certainty-estimated)",
};

const LEGEND: readonly (readonly [Cert, string])[] = [
  ["paid", "Paid"],
  ["confirmed", "Confirmed"],
  ["estimated", "Estimated"],
];

/** Legend matching {@link CERTAINTY_FILL}, shared by both bar charts so their
 *  swatches can't drift from their bars. */
export function CertaintyBarsLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LEGEND.map(([key, name]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-badge" style={{ background: CERTAINTY_FILL[key] }} />
          {name}
        </span>
      ))}
      <span className="font-mono">~ estimated date</span>
    </div>
  );
}
