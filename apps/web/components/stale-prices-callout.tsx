import { Callout } from "@sage/ui";
import { formatDate } from "../lib/format";
import type { StalePriceDTO } from "../lib/types";

export type StalePrice = StalePriceDTO;

/** Show at most this many names per sentence; the rest become "and N more". */
const SHOWN = 4;

/**
 * Shown when a holding is being valued from a price older than a closed market
 * explains.
 *
 * The holding IS in the total — dropping it would take its value out and draw a
 * cliff, which would say you lost money you still have. So the figure stands and
 * the page says how old it is. Before this, a stalled price refresher drew a
 * confident flat line for weeks and reported nothing at all.
 *
 * Two different conditions, said differently. A holding with no newer price is
 * valued at the old close today. One whose bars stopped but which still has a
 * current quote is valued at that quote today — only the chart behind it is
 * old — and telling that reader it "is priced from" August was false about the
 * figure above the chart.
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
  const oldPrice = sorted.filter((s) => !s.quotedToday);
  const oldHistory = sorted.filter((s) => s.quotedToday);

  return (
    <Callout tone="info" className={className}>
      {oldPrice.length > 0 && <OldPriceSentence stale={oldPrice} />}
      {oldPrice.length > 0 && oldHistory.length > 0 && " "}
      {oldHistory.length > 0 && <OldHistorySentence stale={oldHistory} />}
    </Callout>
  );
}

const day = (s: StalePrice) => formatDate(s.asOf, { year: "always" });

function more(stale: StalePrice[]): string {
  const rest = stale.length - SHOWN;
  return rest > 0 ? `, and ${rest} more` : "";
}

function OldPriceSentence({ stale }: { stale: StalePrice[] }) {
  const shown = stale.slice(0, SHOWN);
  return (
    <>
      {shown.length === 1
        ? `${shown[0]!.symbol} is priced from ${day(shown[0]!)}`
        : `Priced from older closes: ${shown.map((s) => `${s.symbol} (${day(s)})`).join(", ")}`}
      {more(stale)}. Those holdings are still counted, at those prices.
    </>
  );
}

function OldHistorySentence({ stale }: { stale: StalePrice[] }) {
  const shown = stale.slice(0, SHOWN);
  return (
    <>
      {shown.length === 1
        ? `Chart history for ${shown[0]!.symbol} stops at ${day(shown[0]!)}`
        : `Chart history stops early for ${shown.map((s) => `${s.symbol} (${day(s)})`).join(", ")}`}
      {more(stale)}. Today&apos;s value uses a current price.
    </>
  );
}
