import { Callout } from "@sage/ui";
import { formatDate } from "../lib/format";

export interface StalePrice {
  symbol: string;
  asOf: string;
}

/**
 * Shown when a holding is being valued from a price older than a closed market
 * explains.
 *
 * The holding IS in the total — dropping it would take its value out and draw a
 * cliff, which would say you lost money you still have. So the figure stands and
 * the page says how old it is. Before this, a stalled price refresher drew a
 * confident flat line for weeks and reported nothing at all.
 *
 * Named, not counted: "3 holdings" sends you hunting, and the fix (or the
 * reassurance that it is an illiquid listing behaving normally) is per-symbol.
 */
export function StalePricesCallout({
  stale,
  className,
}: {
  stale: StalePrice[];
  className?: string;
}) {
  if (stale.length === 0) return null;

  // Oldest first: the one furthest behind is the one worth looking at.
  const sorted = [...stale].sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
  const shown = sorted.slice(0, 4);
  const rest = sorted.length - shown.length;

  return (
    <Callout tone="info" className={className}>
      {shown.length === 1
        ? `${shown[0]!.symbol} is priced from ${formatDate(shown[0]!.asOf, { year: "always" })}`
        : `Priced from older closes: ${shown
            .map((s) => `${s.symbol} (${formatDate(s.asOf, { year: "always" })})`)
            .join(", ")}`}
      {rest > 0 ? `, and ${rest} more` : ""}. Those holdings are still counted, at those prices.
    </Callout>
  );
}
