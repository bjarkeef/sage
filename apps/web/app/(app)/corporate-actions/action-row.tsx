import { Chip, DataRow, RowCell } from "@sage/ui";
import { formatDate } from "../../../lib/format";
import type { CorporateActionDTO } from "../../../lib/types";

/** Column tracks shared with the page's `RowHeader` so header captions line up
 *  with these cells — kept next to the row that draws them, not redeclared. */
export const ACTION_ROW_COLUMNS = "minmax(0,1.6fr) 110px 90px 150px";

/**
 * What Sage did, and what it deliberately did not do. The second half is the
 * point: "corrected nothing" is a different claim from "found nothing", and a
 * reader who cannot tell them apart cannot trust either.
 */
export function verdictCopy(a: CorporateActionDTO): { label: string; body: string } {
  if (a.verdict === "adjusted") {
    const factor = a.detectedFactor?.toFixed(2) ?? "an unknown factor";
    const samples =
      a.mismatchedSamples != null && a.checkedSamples != null
        ? ` ${a.mismatchedSamples} of ${a.checkedSamples} checked trades disagreed.`
        : "";
    return {
      label: "Corrected",
      body:
        `Your price provider back-adjusted this holding's history to the post-split basis ` +
        `while your ledger kept the as-traded prices, so Sage scales historical quantities ` +
        `by ${factor}× when valuing dates before the split.${samples} The ledger is unchanged.`,
    };
  }
  if (a.verdict === "unadjusted") {
    return {
      label: "Not corrected",
      body:
        "Stored prices for this holding agree with your ledger, so its history is treated " +
        "as genuinely unadjusted.",
    };
  }
  const boundary = a.pricesFrom
    ? `stored prices for it begin ${formatDate(a.pricesFrom)}`
    : "there are no stored prices for it";
  return {
    label: "Not checked",
    body:
      `No trade of this holding falls on a day with a stored price — ${boundary}. ` +
      "There is nothing to compare against, so Sage has not adjusted anything. " +
      "Backfilling price history would let it decide.",
  };
}

// Chip tones follow the same convention as `typeChipTone` in transaction
// display: `primary` marks something Sage actually did, `neutral` is the
// no-action state. `income` stays reserved for money-received chips
// (dividends) so it keeps one meaning across the app.
const TONE: Record<CorporateActionDTO["verdict"], "primary" | "neutral"> = {
  adjusted: "primary",
  unadjusted: "neutral",
  unverified: "neutral",
};

/**
 * One corporate action: the compact facts as a readable row, with the full
 * verdict explanation underneath as normal wrapped prose. `RowCell` truncates
 * its content to one line by design (it's built for figures, not paragraphs),
 * so the explanation is deliberately its own block rather than a `secondary`
 * cell — the copy is the point of this page and must never be clipped.
 */
export function ActionRow({ action }: { action: CorporateActionDTO }) {
  const copy = verdictCopy(action);
  return (
    <div className="border-b border-hairline-faint py-2 last:border-b-0">
      <DataRow>
        <RowCell variant="text" primary={action.symbol} secondary={action.name} />
        <RowCell align="right" primary={formatDate(action.date)} />
        <RowCell align="right" primary={action.ratio} />
        <RowCell align="right" primary={<Chip tone={TONE[action.verdict]}>{copy.label}</Chip>} />
      </DataRow>
      <p className="px-3 pt-1.5 text-sm text-muted-foreground">{copy.body}</p>
    </div>
  );
}
