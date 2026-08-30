import { Callout } from "@sage/ui";

/** Shown when the portfolio history reports `fxApproximated`: some dates in the
 *  series had no historical rate, so today's rate stood in for them. */
export function FxApproximatedCallout({ className }: { className?: string }) {
  return (
    <Callout tone="info" className={className}>
      Some dates in this chart have no historical exchange rate yet, so today&apos;s rate was used
      for them.
    </Callout>
  );
}
