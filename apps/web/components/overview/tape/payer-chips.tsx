"use client";

import * as React from "react";
import { Chip } from "@sage/ui";
import type { PayerRank } from "../../../lib/income-tape/aggregates";

/** The hover wash/text only applies to the resting (unfocused) tone — a
 *  focused chip already carries its own emphasis and hover would blur the
 *  distinction DESIGN.md asks the two states to keep. */
const HOVERABLE =
  "transition-colors duration-150 ease-out group-hover:bg-surface-hover group-hover:text-foreground";

function PayerChip({
  payer,
  focused,
  onPick,
}: {
  payer: PayerRank;
  focused: boolean;
  onPick: (symbol: string) => void;
}) {
  const amount = Math.round(payer.next12);
  return (
    <button
      type="button"
      aria-pressed={focused}
      onClick={() => onPick(payer.symbol)}
      className="group cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Chip tone={focused ? "income" : "neutral"} className={focused ? undefined : HOVERABLE}>
        {payer.symbol}
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
}

export function PayerChips({
  payers,
  focus,
  onPick,
}: {
  payers: PayerRank[];
  focus: string | null;
  onPick: (symbol: string) => void;
}) {
  const [showSold, setShowSold] = React.useState(false);
  const held = payers.filter((p) => p.next12 > 0);
  const sold = payers.filter((p) => p.next12 <= 0);
  // Collapsed still shows the focused chip if it happens to be a sold payer —
  // otherwise focusing one from elsewhere (e.g. a deep link) would hide it.
  const visibleSold = showSold ? sold : sold.filter((p) => p.symbol === focus);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1.5 text-xs font-medium text-muted-foreground">Payers</span>
      {held.map((p) => (
        <PayerChip key={p.symbol} payer={p} focused={focus === p.symbol} onPick={onPick} />
      ))}
      {visibleSold.map((p) => (
        <PayerChip key={p.symbol} payer={p} focused={focus === p.symbol} onPick={onPick} />
      ))}
      {sold.length > 0 && (
        <button
          type="button"
          onClick={() => setShowSold((s) => !s)}
          className="cursor-pointer text-xs text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
        >
          {showSold ? "Hide no longer held" : `Show ${sold.length} no longer held`}
        </button>
      )}
    </div>
  );
}
