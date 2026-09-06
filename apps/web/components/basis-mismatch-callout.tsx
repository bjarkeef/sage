import Link from "next/link";
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
  splitSymbols,
}: {
  findings: BasisFindingDTO[];
  unverifiedSplits: string[];
  historyIncomplete: string[];
  /** Every symbol in the ledger carrying a recorded split, regardless of
   *  verdict. A basis finding is split-agnostic by design (see the module
   *  doc above) — a minor-unit mix-up or an ADR ratio change looks identical
   *  to a split from here — so this is the only way to know whether a given
   *  finding has a row waiting for it on /corporate-actions at all. */
  splitSymbols: string[];
}) {
  if (findings.length === 0 && unverifiedSplits.length === 0 && historyIncomplete.length === 0) {
    return null;
  }
  // /corporate-actions only ever renders `type === "split"` transactions. A
  // finding on a symbol with no split row (a minor-unit error, an ADR ratio
  // change) has nothing waiting for it there, so linking would send the
  // reader to a page that never mentions the holding they just read about.
  // `unverifiedSplits` always names a real split by construction; a finding
  // only counts when it lands on a symbol that also appears in `splitSymbols`.
  const splitSymbolSet = new Set(splitSymbols);
  const hasLinkableFinding = findings.some((f) => splitSymbolSet.has(f.symbol));
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
      {/* Only link when there is a corporate action behind this callout: a
       *  finding on an actual split symbol, or an unverified split, both show
       *  up as rows on /corporate-actions. History-incomplete alone, and a
       *  finding on a symbol with no recorded split, have no row to show, so
       *  the link would promise a page with nothing relevant on it. */}
      {(hasLinkableFinding || unverifiedSplits.length > 0) && (
        <p className="mt-3">
          <Link
            href="/corporate-actions"
            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            See what Sage did →
          </Link>
        </p>
      )}
    </Callout>
  );
}
