"use client";

import * as React from "react";
import { PageHeader, type PageHeaderProps } from "@sage/ui";
import { CurrencyPicker } from "./currency-picker";
import { useDisplayCurrency } from "./display-currency-context";

/**
 * `PageHeader` with the display-currency picker appended to its actions row.
 *
 * The picker used to sit in its own `PageShell` above every page header, so it
 * floated unattached in the top-right corner of all nine pages. Composing it
 * here also makes it opt-in: Settings and Import no longer show a
 * display-currency control that does nothing for them.
 *
 * Rule for whether a page should use this instead of plain `PageHeader`: does
 * it display money converted into the display currency? Diversification and
 * Categories do (bucket/node values via `formatMoney` in the fetched display
 * currency) and get it; News shows no money and the custom-holding forms
 * carry their own explicit currency field, where a global toggle would be
 * actively confusing, so they stay on plain `PageHeader`.
 */
export function AppPageHeader({ actions, ...rest }: PageHeaderProps) {
  const currency = useDisplayCurrency();
  return (
    <PageHeader
      {...rest}
      actions={
        <>
          {actions}
          <CurrencyPicker initialCurrency={currency} />
        </>
      }
    />
  );
}
