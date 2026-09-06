import Decimal from "decimal.js";

/** Trim to at most `dp` decimals and drop trailing zeros: 2.5000 → "2.5". */
function trim(d: Decimal, dp = 4): string {
  return d.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toString();
}

/**
 * Human phrasing for a stored split ratio, which is the split transaction's
 * `quantity`: the multiplier applied to a holding's share count.
 *
 * A ratio below 1 is a reverse split — the reader thinks in "10 → 1", not
 * "1 → 0.1", so the reciprocal is what gets printed.
 *
 * Assumes `quantity` is strictly positive. A ratio of zero or less cannot
 * describe a real corporate action — `split-basis.ts` already refuses such
 * rows for the same reason — so this function does not guard against it;
 * callers must filter non-positive quantities before calling it.
 */
export function formatSplitRatio(quantity: Decimal): {
  ratio: string;
  kind: "split" | "reverse-split";
} {
  if (quantity.lessThan(1)) {
    return { ratio: `${trim(new Decimal(1).div(quantity))} → 1`, kind: "reverse-split" };
  }
  return { ratio: `1 → ${trim(quantity)}`, kind: "split" };
}
