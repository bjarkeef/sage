import { formatDate } from "../../../../lib/format";

const dated = (iso: string) => formatDate(iso.slice(0, 10), { year: "always" });

/** The page's provider footnote: the market data on it are snapshots, and this
 *  says from when (spec: Data reliability 2). A figure on the page whose date
 *  is missing says so rather than going unmentioned; nothing renders only when
 *  no provider figure is shown. */
export function ProviderFootnote({
  hasProfileFigures,
  profileAsOf,
  hasRatings,
  ratingsAsOf,
}: {
  hasProfileFigures: boolean;
  profileAsOf: string | null;
  hasRatings: boolean;
  ratingsAsOf: string | null;
}) {
  const parts: string[] = [];
  if (hasProfileFigures) {
    const figures = "Market cap, P/E, beta, payout ratio, the 52-week range and fund data";
    parts.push(
      profileAsOf
        ? `${figures} are the market-data provider's snapshot from ${dated(profileAsOf)}.`
        : `${figures} are the market-data provider's snapshot; its date is unknown.`,
    );
  }
  if (hasRatings) {
    parts.push(
      ratingsAsOf
        ? `Analyst ratings as of ${dated(ratingsAsOf)}.`
        : "Analyst ratings: date unknown.",
    );
  }
  if (parts.length === 0) return null;
  return <p className="mt-2 text-xs text-muted-foreground">{parts.join(" ")}</p>;
}
