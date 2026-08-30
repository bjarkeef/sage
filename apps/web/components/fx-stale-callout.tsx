import { Callout } from "@sage/ui";

/** Shown when a view reports `fxStale`: the stored ECB rates are more than a
 *  week old, so this instance is not reaching ECB. Softer than
 *  {@link FxUnavailableCallout} — totals are complete and roughly right, just
 *  not current. */
export function FxStaleCallout({ asOf, className }: { asOf?: string | null; className?: string }) {
  return (
    <Callout tone="info" className={className}>
      Exchange rates have not refreshed{asOf ? ` since ${asOf}` : ""}. Currency conversions may be
      out of date.
    </Callout>
  );
}
