import type { BasisFindingDTO } from "../lib/types";

/** The warning for a symbol whose transacted prices and stored price history
 *  sit on different share bases. One component, so /holdings and the asset
 *  page say exactly the same thing. */
export function BasisMismatchMark({
  symbol,
  finding,
}: {
  symbol: string;
  finding: BasisFindingDTO;
}) {
  return (
    <span
      role="img"
      aria-label={`Price basis disagrees with your transactions by about ${finding.factor.toFixed(1)}×`}
      title={`Stored prices for ${symbol} are about ${finding.factor.toFixed(1)}× apart from your transactions (${finding.mismatched} of ${finding.samples} checked). Figures including it may be wrong.`}
      className="ml-1.5 inline-block size-1.5 rounded-full bg-muted-foreground align-middle"
    />
  );
}
