import { Callout } from "@sage/ui";
import type { BasisFindingDTO } from "../lib/types";
import { formatDate } from "../lib/format";

/** Shown when a holding's transacted prices and its stored price history are on
 *  different share bases — the prices say one thing about what a share was
 *  worth and the ledger says another.
 *
 *  Deliberately does not name a cause. A split, a minor-unit confusion (pence
 *  against pounds) and an ADR ratio change all look identical from here, and
 *  guessing would be worse than saying what is actually known.
 *
 *  Nothing is corrected: the figures on the page are exactly what they were.
 *  The change is that a wrong number is now a named one. */
export function BasisMismatchCallout({
  findings,
  unverifiedSplits,
  historyIncomplete,
}: {
  findings: BasisFindingDTO[];
  unverifiedSplits: string[];
  historyIncomplete: string[];
}) {
  if (findings.length === 0 && unverifiedSplits.length === 0 && historyIncomplete.length === 0) {
    return null;
  }
  return (
    <Callout tone="info">
      {findings.length > 0 && (
        <>
          <p>
            {findings.length === 1
              ? "One holding's stored price history disagrees with your transactions:"
              : `${findings.length} holdings' stored price history disagrees with your transactions:`}
          </p>
          <ul className="mt-2 space-y-1">
            {findings.map((f) => (
              <li key={f.symbol}>
                <span className="font-medium">{f.symbol}</span>
                <span className="tabular-nums">
                  {` — about ${f.factor.toFixed(1)}× apart on ${f.mismatched} of ${f.samples} checked transactions, between ${formatDate(f.firstDate)} and ${formatDate(f.lastDate)}.`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Figures including these holdings may be wrong. Nothing has been adjusted.
          </p>
        </>
      )}
      {unverifiedSplits.length > 0 && (
        <p className={findings.length > 0 ? "mt-3" : undefined}>
          {`${unverifiedSplits.join(", ")} recorded a share split whose effect on stored prices could not be checked — no transaction of ${unverifiedSplits.length === 1 ? "its" : "theirs"} falls on a day with a stored price. Nothing has been corrected for ${unverifiedSplits.length === 1 ? "it" : "them"}.`}
        </p>
      )}
      {/* Says only what is known: the period is short. No cause, and no
       *  suggestion that waiting helps — a symbol whose provider has no data
       *  reaching that far back stays here indefinitely, so inviting a retry
       *  would be a promise the app cannot keep. */}
      {historyIncomplete.length > 0 && (
        <p className={findings.length > 0 || unverifiedSplits.length > 0 ? "mt-3" : undefined}>
          {`${historyIncomplete.join(", ")} ${historyIncomplete.length === 1 ? "has" : "have"} no stored price history reaching back to when ${historyIncomplete.length === 1 ? "it was" : "they were"} first held, so the figures above cover a shorter period than the selected range.`}
        </p>
      )}
    </Callout>
  );
}
