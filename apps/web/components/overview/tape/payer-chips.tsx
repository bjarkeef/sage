"use client";

import { Chip } from "@sage/ui";
import type { PayerRank } from "../../../lib/income-tape/aggregates";

export function PayerChips({
  payers,
  focus,
  onPick,
}: {
  payers: PayerRank[];
  focus: string | null;
  onPick: (symbol: string) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1.5 text-xs font-medium text-muted-foreground">Payers</span>
      {payers.map((p) => {
        const amount = Math.round(p.next12);
        return (
          <button
            key={p.symbol}
            type="button"
            aria-pressed={focus === p.symbol}
            onClick={() => onPick(p.symbol)}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Chip tone={focus === p.symbol ? "income" : "neutral"}>
              {p.symbol}
              {/* A sold payer has nothing coming: no amount, never a bare 0. Chip
                is inline-flex, which drops the space between flex items, so
                the margin draws the gap and the space keeps the name readable. */}
              {amount > 0 && (
                <>
                  {" "}
                  <span className="ml-1 opacity-70">{amount.toLocaleString("en-US")}</span>
                </>
              )}
            </Chip>
          </button>
        );
      })}
    </div>
  );
}
