import { Chip, DataRow, RowCell } from "@sage/ui";
import { formatDate } from "../../../lib/format";
import type { CorporateActionDTO } from "../../../lib/types";

/** Column tracks shared with the page's `RowHeader` so header captions line up
 *  with these cells — kept next to the row that draws them, not redeclared. */
export const ACTION_ROW_COLUMNS = "minmax(0,1.6fr) 110px 90px 150px";

/** `detectedFactor.toFixed(1)×`, or a fallback that still reads as prose on
 *  its own — `detectedFactor` should always be present alongside a finding,
 *  but a broken template ("an unknown factor× when valuing...") is worse than
 *  a defensive branch that never fires. Fixed to one decimal to match the
 *  `/performance` banner reporting the same number (`toFixed(1)` there too) —
 *  two screens quoting the same divergence to different precision reads as
 *  two different measurements. */
function divergenceText(factor: number | null): string {
  return factor != null ? `about ${factor.toFixed(1)}×` : "by an amount Sage did not record";
}

/**
 * What Sage did, and what it deliberately did not do. The second half is the
 * point: "corrected nothing" is a different claim from "found nothing", and a
 * reader who cannot tell them apart cannot trust either.
 */
/** An exact applied multiplier, as opposed to `divergenceText`'s measured and
 *  deliberately hedged one: no "about", and no trailing zeros to suggest a
 *  precision the product does not have. */
function factorText(factor: number): string {
  return `${Number(factor.toFixed(4))}×`;
}

export function verdictCopy(a: CorporateActionDTO): { label: string; body: string } {
  if (a.verdict === "adjusted") {
    // `detectedFactor` is the OBSERVED PRICE DIVERGENCE between the provider's
    // history and the ledger (`BasisFinding.factor`, always ≥ 1.5, direction-
    // agnostic) — it is NOT the multiplier Sage applies to historical
    // quantities. That multiplier is the recorded split ratio itself (`a.ratio`,
    // already on this row via `SplitBasisResolution.factorAt`). On a 10-for-1
    // reverse split the two differ by roughly 100x: a ~10x observed divergence
    // next to a 0.1x actual multiplier. Naming the divergence as the applied
    // factor was this page's worst defect, so the two numbers are kept
    // explicitly separate below rather than merged into one claim.
    const divergence = divergenceText(a.detectedFactor);
    const samples =
      a.mismatchedSamples != null && a.checkedSamples != null
        ? ` ${a.mismatchedSamples} of ${a.checkedSamples} checked trades disagreed.`
        : "";
    const opening =
      `Your price provider back-adjusted this holding's history to the post-split basis ` +
      `while your ledger kept the as-traded prices, so the two disagree ${divergence} on ` +
      `dates before the split.${samples} `;
    // `factorAt` multiplies EVERY split dated after a point, so on a symbol
    // that split more than once this row's own ratio is not the multiplier —
    // the product is. Saying "that ratio" here was true only for a symbol's
    // last split, and on a twice-split holding it put two different wrong
    // numbers on two rows of the same page.
    if (a.cumulativeFactor != null) {
      return {
        label: "Corrected",
        body:
          opening +
          `This holding split again after ${formatDate(a.date)}, and Sage applies every ` +
          `later split too, so quantities dated before it are scaled by ${factorText(a.cumulativeFactor)} ` +
          `— the recorded ${a.ratio} split compounded with the ones that followed, not this ` +
          `row's ratio alone and not by the price gap above. The ledger is unchanged.`,
      };
    }
    return {
      label: "Corrected",
      body:
        opening +
        `Sage corrected for this using the recorded ${a.ratio} ` +
        `split: historical quantities are scaled by that ratio, not by the price gap above. ` +
        `The ledger is unchanged.`,
    };
  }
  if (a.verdict === "unadjusted") {
    if (a.detectedFactor != null) {
      // A finding exists here too, but its drift from what the recorded split
      // predicts exceeded tolerance, so the split does not explain it.
      // `/performance`'s banner keeps exactly this symbol in its mismatch
      // list — this page must say the same thing, not the opposite of it.
      const divergence = divergenceText(a.detectedFactor);
      const samples =
        a.mismatchedSamples != null && a.checkedSamples != null
          ? ` ${a.mismatchedSamples} of ${a.checkedSamples} checked trades disagreed ${divergence}.`
          : ` They disagree ${divergence}.`;
      return {
        label: "Not corrected",
        body:
          `Stored prices for this holding do NOT agree with your ledger, and the recorded ` +
          `split does not explain the gap.${samples} Sage has not corrected anything for it — ` +
          `correcting on a guess could turn a genuinely unadjusted history into a wrong one.`,
      };
    }
    return {
      label: "Not corrected",
      body:
        "Stored prices for this holding agree with your ledger, so its history is treated " +
        "as genuinely unadjusted. Sage has not changed anything for it.",
    };
  }
  if (a.fxGap) {
    // Bars DO exist here — this trade landed on a day with a stored price.
    // What is missing is an exchange rate to compare it in the bar's own
    // currency, so the boundary-dated remedy below (which assumes the gap IS
    // missing price history) would be a promise backfilling cannot keep.
    return {
      label: "Not checked",
      body:
        "This holding's trades do land on days with a stored price, but at least one traded " +
        "in a different currency than the stored price and Sage has no exchange rate to " +
        "convert it, so there is nothing to compare against. Sage has not adjusted anything. " +
        "The gap is a missing exchange rate, not missing price history, so backfilling price " +
        "history would not change this.",
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
    // `role="rowgroup"` because this wraps a `role="row"` (`DataRow`) plus a
    // plain paragraph inside the page's `RowGrid`, which is `role="table"`.
    // An unmarked wrapping `div` between a table and its rows breaks ARIA
    // ownership — assistive tech looks for `row`/`rowgroup` children of a
    // table, not an anonymous `div` — so a screen reader could skip every row
    // silently. `rowgroup` is the correct container for "a row plus
    // supplementary content that isn't itself a row".
    <div role="rowgroup" className="border-b border-hairline-faint py-2 last:border-b-0">
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
