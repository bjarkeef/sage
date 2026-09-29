"use client";

import * as React from "react";
import type { ResolvedRange } from "../../../lib/income-tape/ranges";
import { changePct, type Totals } from "../../../lib/income-tape/aggregates";
import { dayToIso } from "../../../lib/income-tape/points";
import { useRollingNumber } from "./use-rolling-number";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 2026 – Sep 2027" for a half-open day range; label-caps uppercases it. */
export function formatDates([from, to]: [number, number]): string {
  const a = dayToIso(from);
  const b = dayToIso(to - 1);
  const f = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
  return `${f(a)} – ${f(b)}`;
}

const numberPart = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const SWATCH: [keyof Totals, string, string][] = [
  ["paid", "paid", "var(--certainty-paid)"],
  ["confirmed", "confirmed", "var(--certainty-confirmed)"],
  ["estimated", "estimated", "var(--certainty-estimated)"],
];

export function TapeHud({
  range,
  totals,
  prev,
  currency,
  focus,
  motion,
  brief,
  aside,
}: {
  range: ResolvedRange;
  totals: Totals;
  prev: Totals | null;
  currency: string;
  focus: string | null;
  motion: boolean;
  brief?: React.ReactNode;
  /** Takes the comparison's slot — the focus card while a payer is focused. */
  aside?: React.ReactNode;
}) {
  const figure = useRollingNumber(totals.total, motion, numberPart);
  const change = prev ? changePct(totals.total, prev.total) : null;
  const changeRoll = useRollingNumber(change ?? 0, motion, signedPct);
  // `aside` is the focus card taking the comparison's slot. Keep the
  // comparison mounted (just hidden) rather than swapping it out — removing
  // it would let the slot collapse to the card's own (taller) height and
  // shift the tape below. The card overlays it absolutely instead.
  const showAside = aside !== undefined;
  const comparison = range.compareLabel && prev && (
    <div className={`text-right text-sm text-muted-foreground ${showAside ? "invisible" : ""}`}>
      <p>vs {range.compareLabel}</p>
      <p className={`stat-num ${change == null ? "" : change >= 0 ? "text-gain" : "text-loss"}`}>
        {change == null ? "new" : <span ref={changeRoll.ref}>{changeRoll.text}</span>}
      </p>
      <p className="font-mono tabular-nums">
        {currency} {Math.round(prev.total).toLocaleString("en-US")}
      </p>
    </div>
  );

  return (
    // `lg:flex-row lg:flex-nowrap`, not `flex-wrap`: with the right column
    // fixed at 310px, a wrapping flex container still breaks onto two lines
    // whenever the LEFT column's un-shrunk (hypothetical) width doesn't fit —
    // `min-w-0` only lets it shrink once it's already on a line, it doesn't
    // stop the wrap decision. Wrapped, the right-hand slot lands on its own
    // row under the figure, and the card — anchored to the slot's bottom,
    // growing upward — then overlaps the figure it's supposed to sit beside.
    // Forcing one row and letting the left column shrink (`min-w-0 flex-1`)
    // removes the wrap entirely, so the two columns can never overlap.
    // Measured in the browser: `sm` (640) still overflowed `main` horizontally
    // between 640–768, so the two-column row only turns on at `lg` (1024) —
    // 1024 itself keeps the row layout; everything below it stacks.
    <div className="flex flex-col gap-6 lg:flex-row lg:flex-nowrap lg:items-end lg:justify-between">
      <div className="min-w-0 lg:flex-1">
        {/* One line at every width: focusing prefixes the ticker, and that
            extra text used to wrap the eyebrow onto a second line below `lg`,
            shifting the tape 15px on focus. The label (name + optional
            ticker) never wraps or shrinks; the dates truncate instead. */}
        <p className="label-caps flex min-w-0 gap-x-2 text-muted-foreground">
          <span className="shrink-0 whitespace-nowrap text-foreground">
            {focus ? `${focus} · ${range.label}` : range.label}
          </span>
          <span className="min-w-0 truncate">{formatDates(range.dates)}</span>
        </p>
        <p className="mt-3 horizon-num">
          <span className="pr-1.5 align-baseline text-lg font-light text-muted-foreground">
            {currency}
          </span>
          <span ref={figure.ref}>{figure.text}</span>
        </p>
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs tabular-nums text-muted-foreground">
          {SWATCH.map(([k, word, tone]) => (
            <span key={word} className="flex items-center gap-1.5">
              <i
                aria-hidden
                className="h-3 w-1.5 flex-none rounded-full"
                style={{ background: tone }}
              />
              {word} {Math.round(totals[k]).toLocaleString("en-US")}
            </span>
          ))}
          <span>
            {totals.count} {totals.count === 1 ? "payment" : "payments"}
          </span>
        </p>
        {brief && <div className="mt-4">{brief}</div>}
      </div>
      {(comparison || showAside) && (
        <div
          // At `lg`+ this box is sized by the comparison's own (in-flow)
          // height, and the card overlays it absolutely — the HUD's height
          // never depends on the card. Below `lg`, where the columns stack
          // (this row sits under the figure instead of beside it), the
          // reserved `min-h-60` (240px) stands in for the card's own height:
          // FocusCard is p-4 (32px) + a symbol line + a name/frequency line
          // (mb-3) + a 5-row `dl` (gap-y-1) — measured ~235px in the browser,
          // so 240px keeps the row from resizing when the card replaces the
          // comparison in view.
          className="relative min-h-0 shrink-0 max-lg:min-h-60 lg:w-[310px]"
        >
          {comparison}
          {showAside && (
            <div className="absolute bottom-0 right-0 z-20 w-[310px] max-w-full">{aside}</div>
          )}
        </div>
      )}
    </div>
  );
}
