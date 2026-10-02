"use client";

import * as React from "react";
import { DataRow, RowCell, RowGrid, RowHeader } from "@sage/ui";
import { formatDate } from "../../../../lib/format";
import { formatPerShare } from "../../../../lib/asset-page/labels";
import type { AssetDividendsDTO } from "../../../../lib/types";
import { Missing } from "./reliability-marks";

/** Every payment on record, newest first, behind a link: ex-date, paid date,
 *  amount per share as money (never the provider's raw "0.67492 EUR"). Dates
 *  are text cells and amounts figure cells, so each column keeps one font. */
export function PaymentsList({ history }: { history: AssetDividendsDTO["history"] }) {
  const [open, setOpen] = React.useState(false);
  if (history.length === 0) return null;
  return (
    <div className="mt-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-control text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? "Hide payments" : `All ${history.length} payments`}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[20rem]">
            <RowGrid columns="minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)">
              <RowHeader
                cells={["Ex-date", "Paid", "Per share"]}
                align={["left", "left", "right"]}
              />
              {history.map((d, i) => (
                <DataRow key={`${d.exDate}-${i}`}>
                  <RowCell variant="text" primary={formatDate(d.exDate, { year: "always" })} />
                  <RowCell
                    variant="text"
                    primary={
                      d.paymentDate ? (
                        formatDate(d.paymentDate, { year: "always" })
                      ) : (
                        <Missing reason="The provider gave no payment date" />
                      )
                    }
                  />
                  <RowCell
                    align="right"
                    primary={formatPerShare({ amount: d.amountPerShare, currency: d.currency })}
                  />
                </DataRow>
              ))}
            </RowGrid>
          </div>
        </div>
      )}
    </div>
  );
}
