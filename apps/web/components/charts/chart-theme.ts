/** Shared Recharts styling so every Sage chart reads as one system. CSS-var
 *  values resolve against the themed token layer (light/dark) inside the SVG. */

/** Muted, tabular tick text for category/value axes. */
export const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

/** Hairline grid lines — depth from a whisper, not a box. */
export const GRID_STROKE = "var(--hairline)";

/** The soft wash Recharts paints behind the hovered category. */
export const CURSOR_FILL = "var(--surface-hover)";

/** Mono numerals for value labels drawn onto the plot (LabelList). */
export const LABEL_STYLE = {
  fill: "var(--muted-foreground)",
  fontSize: 11,
  fontFamily: "var(--ff-mono)",
} as const;

/** The segment ramp (`--seg-*` in packages/ui tokens.css), keyed by a row's
 *  position so a donut segment and its table row carry the same colour.
 *  `--seg-rest` is the shared tail: past the ramp every row gets it, and the
 *  chart and the table still agree because both call `segColor`.
 *
 *  It lives in this recharts-FREE module on purpose. It was previously exported
 *  from `income-composition.tsx`, which imports recharts — and because the
 *  statically-imported holdings table pulled the constant from there, recharts
 *  landed in /dividends/analytics' initial bundle and every `dynamic()` on that
 *  page bought nothing (279 kB First Load JS against 171 kB for /goal, which
 *  defers the same library successfully). Keep colour constants out of modules
 *  that import a charting library. */
export const SEG = [
  "var(--seg-1)",
  "var(--seg-2)",
  "var(--seg-3)",
  "var(--seg-4)",
  "var(--seg-5)",
  "var(--seg-6)",
  "var(--seg-7)",
  "var(--seg-rest)",
] as const;

export function segColor(i: number): string {
  return SEG[Math.min(i, SEG.length - 1)]!;
}
