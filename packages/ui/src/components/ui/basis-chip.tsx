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
 * Deliberately NOT `label-caps`: DESIGN.md's one-caps-per-region rule counts
 * `label-caps` elements, and a card's own `Stat`/eyebrow label already
 * claims that budget. This chip is mono context — DESIGN.md lists chips as
 * a legitimate one — styled by hand instead of the shared `label-caps`
 * utility class, so it never competes for that slot.
 */
export function BasisChip({ taxed, className }: BasisChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-badge bg-surface-hover px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground",
        className,
      )}
    >
      {taxed ? "After tax" : "Before tax"}
      <InfoTooltip label="About this figure">
        {taxed ? "After" : "Before"} dividend tax
        {taxed ? " (your single configured rate, applied flatly)" : ""}.
      </InfoTooltip>
    </span>
  );
}
