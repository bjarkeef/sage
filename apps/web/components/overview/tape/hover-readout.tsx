"use client";

import type { TapePoint } from "../../../lib/income-tape/points";
import { changePct } from "../../../lib/income-tape/aggregates";
import { formatDate } from "../../../lib/format";

export function HoverReadout({
  point: p,
  ghost,
  currency,
  x,
  y,
}: {
  point: TapePoint;
  ghost: TapePoint | null;
  currency: string;
  x: number;
  y: number;
}) {
  const ch = ghost ? changePct(p.amount, ghost.amount) : null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-control border border-hairline bg-card px-2.5 py-1.5 text-xs shadow-sm"
      style={{ left: x, top: y }}
    >
      <b className="font-mono font-medium">{p.symbol}</b> · {currency}{" "}
      {p.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      <span className="text-muted-foreground">
        {" "}
        · {formatDate(p.iso, { year: "always" })} · {p.certainty}
        {ch != null && (
          <>
            {" "}
            ·{" "}
            <span
              className={ch >= 0 ? "text-gain" : "text-loss"}
            >{`${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%`}</span>{" "}
            on last year
          </>
        )}
      </span>
    </div>
  );
}
