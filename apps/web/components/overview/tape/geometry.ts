/** Room under the axis for month name, month total and year-over-year. */
export const AXIS_FROM_BOTTOM = 96;
/** Labels never rise above this (the TODAY tag and year labels live there). */
export const PLOT_TOP = 64;

export function baseline(height: number): number {
  return height - AXIS_FROM_BOTTOM;
}

/** One scale for the whole history, so a bar means the same amount wherever
 *  the reader has panned to. The 56px margin (not 40, see task-7-report.md)
 *  is the minimum headroom a 3-line label (symbol / amount / YoY change)
 *  needs above the tallest possible bar before it hits `PLOT_TOP`. */
export function barHeight(amount: number, maxAmount: number, height: number): number {
  const room = baseline(height) - PLOT_TOP - 56;
  return Math.max(3, (amount / Math.max(maxAmount, 1)) * room);
}

export function barWidth(pxPerDay: number): number {
  return Math.max(3, Math.min(9, pxPerDay * 2.2));
}
