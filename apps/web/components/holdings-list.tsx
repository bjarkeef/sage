"use client";

import * as React from "react";
import Link from "next/link";
import { Delta, SegmentedControl, EmptyState, buttonVariants } from "@sage/ui";
import type { PositionDTO, SubtotalDTO } from "../lib/types";
import { formatMoney, moneyToNumber } from "../lib/format";
import { HOLDING_ROW_GRID, HoldingRow } from "./holding-row";

type SortKey = "value" | "return" | "today" | "yield" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "value", label: "Value" },
  { key: "return", label: "Return" },
  { key: "today", label: "Today" },
  { key: "yield", label: "Yield" },
  { key: "name", label: "Name" },
];

const SORT_OPTIONS = SORTS.map(({ key, label }) => ({ value: key, label }));

/** Numeric sort handle for a position under a given key; missing data sorts last. */
function sortValue(p: PositionDTO, key: SortKey): number {
  switch (key) {
    case "value":
      return p.marketValue ? moneyToNumber(p.marketValue) : -Infinity;
    case "return":
      // Rank by the unrealized price-gain % shown on the row (not total-return %,
      // which folds in lifetime dividends over a possibly shrunken cost basis).
      return p.gainLossPercent ?? -Infinity;
    case "today":
      return p.dailyChangePercent ?? -Infinity;
    case "yield":
      return p.yieldOnCost ?? -Infinity;
    case "name":
      return 0;
  }
}

export function HoldingsList({
  positions,
  subtotals,
}: {
  positions: PositionDTO[];
  subtotals: SubtotalDTO[];
}) {
  const [sort, setSort] = React.useState<SortKey>("value");

  if (positions.length === 0) {
    // The same centred shape Goal and Diversification use, and the same two
    // ways out: a bare left-aligned sentence here read as a rendering
    // accident beside them, and named only the slower of the two routes in.
    return (
      <EmptyState
        message="No positions yet. Bring in your whole book from a broker CSV, or add a transaction by hand."
        action={
          <Link href="/import" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Import transactions →
          </Link>
        }
      />
    );
  }

  const byCurrency = new Map<string, PositionDTO[]>();
  for (const p of positions) {
    const list = byCurrency.get(p.currency) ?? [];
    list.push(p);
    byCurrency.set(p.currency, list);
  }
  const subtotalFor = (ccy: string) => subtotals.find((s) => s.currency === ccy);

  const sortRows = (rows: PositionDTO[]) =>
    [...rows].sort((a, b) =>
      sort === "name" ? a.symbol.localeCompare(b.symbol) : sortValue(b, sort) - sortValue(a, sort),
    );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        {/* Sans text-xs/font-medium, not label-caps: that token is a caps
            eyebrow over a figure, never a form label (DESIGN.md). */}
        <span id="holdings-sort-label" className="text-xs font-medium text-foreground">
          Sort
        </span>
        {/* The five options (~312px) can exceed a 375px content column, so this
            scrolls horizontally rather than wrapping or overflowing the page.
            The -mx-1/px-1 pair gives the focused option's ring room so
            overflow-x-auto's clip doesn't cut it off at the scroll edge. */}
        <div
          data-testid="holdings-sort-scroll"
          className="-mx-1 min-w-0 max-w-full overflow-x-auto px-1"
        >
          <SegmentedControl
            options={SORT_OPTIONS}
            value={sort}
            onChange={(value) => setSort(value as SortKey)}
            aria-labelledby="holdings-sort-label"
            size="sm"
          />
        </div>
      </div>

      {[...byCurrency.entries()].map(([currency, rows]) => {
        const sub = subtotalFor(currency);
        const groupTotal = sub ? moneyToNumber(sub.marketValue) : 0;
        return (
          <section key={currency} className="space-y-2">
            <div
              data-testid={`currency-summary-${currency}`}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-hairline pb-2"
            >
              <span className="whitespace-nowrap label-caps text-muted-foreground">
                {currency} · {rows.length} {rows.length === 1 ? "holding" : "holdings"}
              </span>
              {sub && (
                <span className="whitespace-nowrap text-right">
                  <span className="block font-mono text-data tabular-nums">
                    {formatMoney(sub.marketValue)}
                  </span>
                  <Delta
                    value={moneyToNumber(sub.gainLoss)}
                    currency={currency}
                    className="justify-end text-xs"
                  />
                </span>
              )}
            </div>

            <div className={`${HOLDING_ROW_GRID} px-3 pb-1 pt-1`}>
              <span className="label-caps text-muted-foreground">Holding</span>
              <span className="hidden text-right label-caps text-muted-foreground md:block">
                Value
              </span>
              <span className="text-right label-caps text-muted-foreground">Return</span>
              <span className="hidden text-right label-caps text-muted-foreground md:block">
                Weight
              </span>
            </div>

            <div className="space-y-0.5">
              {sortRows(rows).map((p) => (
                <HoldingRow key={p.symbol} position={p} groupTotal={groupTotal} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
