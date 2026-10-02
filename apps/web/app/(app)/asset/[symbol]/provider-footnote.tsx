import { formatDate } from "../../../../lib/format";

/** The page's provider footnote: the market data on it are snapshots, and this
 *  says from when (spec: Data reliability 2). */
export function ProviderFootnote({
  profileAsOf,
  ratingsAsOf,
}: {
  profileAsOf: string | null;
  ratingsAsOf: string | null;
}) {
  const parts: string[] = [];
  if (profileAsOf) {
    parts.push(
      `Market cap, P/E, beta, payout ratio, the 52-week range and fund data are the market-data provider's snapshot from ${formatDate(profileAsOf.slice(0, 10), { year: "always" })}.`,
    );
  }
  if (ratingsAsOf) {
    parts.push(
      `Analyst ratings as of ${formatDate(ratingsAsOf.slice(0, 10), { year: "always" })}.`,
    );
  }
  if (parts.length === 0) return null;
  return <p className="mt-2 text-xs text-muted-foreground">{parts.join(" ")}</p>;
}
