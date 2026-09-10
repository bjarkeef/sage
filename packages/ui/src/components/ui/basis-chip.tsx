import { Chip } from "./chip";
import { InfoTooltip } from "./tooltip";
import { cn } from "../../lib/utils";

export interface BasisChipProps {
  /** Whether a dividend tax rate is currently configured. Governs both the
   *  label ("After tax" vs "Before tax") and the tooltip's phrasing. */
  taxed: boolean;
  className?: string;
}

/**
 * A basis marker for any card whose headline figure is derived from dividend
 * income: states plainly whether that figure is net or gross of the user's
 * configured dividend tax rate, with an `InfoTooltip` carrying the
 * explanation. Sits in `CardTitle`'s trailing `meta` slot — the same corner
 * on every card that shows money — so a reader looking at any single card
 * can tell its basis without hunting for the page-level note.
 *
 * The tax-rate clause is carried over unchanged from the wording
 * `income-card.tsx` used before this primitive existed, so the explanation
 * cannot fork between cards; the card-specific lead-in and trailer that
 * described THAT card's own layout ("this month's...", "the bar shows...")
 * were dropped rather than copied — they would misdescribe a chart card with
 * no bar.
 *
 * Built on the shared `Chip` primitive rather than a hand-tuned near-copy of
 * it: `Chip` already composes `rounded-badge px-1.5 py-0.5 label-caps`, and
 * `label-caps` is DESIGN.md's one caps utility, explicitly shared by `Stat`
 * labels, `Chip` text, and `RowHeader` column headers — not a separate size
 * per use. None of this chip's six call sites (`IncomeCard`, `UpcomingCard`,
 * `ForwardPayments`, `MonthlyRhythm`, `YieldByHolding`, `IncomeTimeline`)
 * pair it with a `Stat`/eyebrow label in the same card, so the
 * one-caps-per-region budget DESIGN.md guards isn't spent twice here.
 */
export function BasisChip({ taxed, className }: BasisChipProps) {
  return (
    <Chip className={cn("gap-1 whitespace-nowrap", className)}>
      {taxed ? "After tax" : "Before tax"}
      <InfoTooltip label="About this figure">
        {taxed ? "After" : "Before"} dividend tax
        {taxed ? " (your single configured rate, applied flatly)" : ""}.
      </InfoTooltip>
    </Chip>
  );
}
