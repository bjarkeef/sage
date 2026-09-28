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
  currency: string;
  onPick: (symbol: string) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="label-caps mr-1.5 text-muted-foreground">Payers</span>
      {payers.map((p) => (
        <button
          key={p.symbol}
          type="button"
          aria-pressed={focus === p.symbol}
          onClick={() => onPick(p.symbol)}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Chip tone={focus === p.symbol ? "income" : "neutral"}>
            {p.symbol}{" "}
            <span className="opacity-70">{Math.round(p.next12).toLocaleString("en-US")}</span>
          </Chip>
        </button>
      ))}
    </div>
  );
}
