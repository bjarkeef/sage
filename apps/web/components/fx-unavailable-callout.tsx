import type { ReactNode } from "react";
import { Callout } from "@sage/ui";

/** Shown when a view reports `fxIncomplete`: exchange rates could not be
 *  resolved for some held currency, so those amounts are left out of the
 *  converted totals rather than blended in at the wrong scale. A prominent
 *  banner (not a footnote) because it materially changes the figures — the
 *  numbers read low while it's showing.
 *
 *  @param children Replacement copy for views where the default (written for
 *    dividend totals) would name the wrong thing — a chart loses value and cost
 *    lines, not income. The banner itself is the shared part. */
export function FxUnavailableCallout({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Callout tone="info" className={className}>
      {children ??
        "Exchange rates are temporarily unavailable, so dividends in other currencies are left out of these totals — income and yield below read low until rates refresh."}
    </Callout>
  );
}
