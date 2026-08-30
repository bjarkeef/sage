"use client";

import * as React from "react";
import { Card, DataRow, RowCell, RowGrid, RowHeader, SectionHeader, Stat } from "@sage/ui";
import { formatDate, formatMoney } from "../../../../lib/format";
import type { AssetDetailDTO } from "../../../../lib/types";

const PREVIEW = 6;

export function DividendHistory({
  dividends,
  currency,
}: {
  dividends: AssetDetailDTO["dividends"];
  currency: string;
}) {
  const [showAll, setShowAll] = React.useState(false);
  if (dividends.history.length === 0) return null;
  const rows = showAll ? dividends.history : dividends.history.slice(0, PREVIEW);
  const cagr = dividends.cagr5y != null ? Number(dividends.cagr5y) * 100 : null;

  return (
    <section className="mb-10">
      <SectionHeader title="Dividends" meta={`${dividends.history.length} payments`} />
      <Card>
        {/* Dividend growth is the decision-relevant figure here — a toned stat,
          not a muted chip. */}
        <div className="mb-5 flex gap-12">
          <Stat
            size="sm"
            label="TTM per share"
            value={formatMoney({ amount: dividends.trailingTwelveMonthTotal, currency })}
          />
          {cagr != null && (
            <Stat
              size="sm"
              label="5Y growth"
              value={
                <span className={cagr > 0 ? "text-gain" : cagr < 0 ? "text-loss" : undefined}>
                  {cagr >= 0 ? "+" : "−"}
                  {Math.abs(cagr).toFixed(1)}%
                </span>
              }
              context="dividend CAGR"
            />
          )}
        </div>
        <RowGrid columns="minmax(0,1fr) 140px 140px">
          <RowHeader cells={["Ex-date", "Amount/share", "Paid"]} />
          {rows.map((d, i) => (
            <DataRow key={`${d.exDate}-${i}`}>
              <RowCell variant="text" primary={formatDate(d.exDate, { year: "always" })} />
              <RowCell align="right" primary={`${d.amountPerShare} ${d.currency}`} />
              <RowCell
                align="right"
                primary={d.paymentDate ? formatDate(d.paymentDate, { year: "always" }) : "—"}
                className="text-muted-foreground"
              />
            </DataRow>
          ))}
        </RowGrid>
        {dividends.history.length > PREVIEW && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-3 text-sm text-muted-foreground hover:text-foreground"
          >
            {showAll ? "Show less" : `Show all ${dividends.history.length} payments →`}
          </button>
        )}
      </Card>
    </section>
  );
}
