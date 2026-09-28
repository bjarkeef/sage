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
  const changeRef = useRollingNumber(
    change ?? 0,
    motion,
    (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`,
  );

  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0">
        <p className="label-caps flex flex-wrap gap-x-2 text-muted-foreground">
          <span className="text-foreground">
            {focus ? `${focus} · ${range.label}` : range.label}
          </span>
          <span>{formatDates(range.dates)}</span>
        </p>
        <p className="mt-3 horizon-num">
          <span className="pr-1.5 align-baseline text-lg font-light text-muted-foreground">
            {currency}
          </span>
          <span ref={figure}>{numberPart(totals.total)}</span>
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
      {aside ??
        (range.compareLabel && prev && (
          <div className="text-right text-sm text-muted-foreground">
            <p>vs {range.compareLabel}</p>
            <p
              className={`stat-num ${change == null ? "" : change >= 0 ? "text-gain" : "text-loss"}`}
            >
              {change == null ? (
                "new"
              ) : (
                <span ref={changeRef}>{`${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</span>
              )}
            </p>
            <p className="font-mono tabular-nums">
              {currency} {Math.round(prev.total).toLocaleString("en-US")}
            </p>
          </div>
        ))}
    </div>
  );
}
