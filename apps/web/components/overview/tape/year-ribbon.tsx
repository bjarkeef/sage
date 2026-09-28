"use client";

import * as React from "react";
import type { PaymentCertainty } from "../../../lib/types";
import { changePct, type Totals } from "../../../lib/income-tape/aggregates";
import { yearStartDay } from "../../../lib/income-tape/points";
import type { GoalMark } from "../../../lib/income-tape/goal-line";
import { useElementSize } from "./use-element-size";

const H = 150;
const BASE = 112;
const TOP = 18;
const ORDER: PaymentCertainty[] = ["paid", "confirmed", "estimated"];
const TONE: Record<PaymentCertainty, string> = {
  paid: "var(--certainty-paid)",
  confirmed: "var(--certainty-confirmed)",
  estimated: "var(--certainty-estimated)",
};

/**
 * One bar per calendar year: the growth staircase, and the year navigator.
 * Partial years (the book's first, the forecast's last) are marked and get no
 * change on either side — a part year against a whole one is not growth.
 */
export function YearRibbon({
  years,
  inView,
  currency,
  selectedYear,
  goal,
  onPickYear,
}: {
  years: { year: number; totals: Totals; partial: boolean }[];
  inView: [number, number];
  /** Names the amount for a screen reader; the drawn figure sits under the HUD's. */
  currency: string;
  selectedYear: number | null;
  goal: GoalMark;
  onPickYear: (year: number) => void;
}) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const max =
    Math.max(1, ...years.map((y) => y.totals.total), goal.kind === "line" ? goal.amount : 0) * 1.05;
  const sc = (v: number) => (v / max) * (BASE - TOP);
  const colW = years.length ? width / years.length : 0;
  const bw = Math.min(64, colW * 0.5);
  const partial = years.some((y) => y.partial);

  return (
    <div ref={ref} className="mt-6">
      {width > 0 && (
        <div className="relative" style={{ height: H }}>
          {years.map((y, i) => {
            const prev = years[i - 1];
            const ch =
              prev && !prev.partial && !y.partial
                ? changePct(y.totals.total, prev.totals.total)
                : null;
            const inRange =
              yearStartDay(y.year + 1) > inView[0] && yearStartDay(y.year) < inView[1];
            const selected = selectedYear === y.year;
            let stackTop = BASE;
            return (
              <button
                key={y.year}
                type="button"
                aria-label={`${y.year}: ${currency} ${Math.round(y.totals.total).toLocaleString("en-US")}`}
                aria-pressed={selected}
                onClick={() => onPickYear(y.year)}
                className={`absolute top-0 rounded-card transition-colors hover:bg-surface-hover ${selected ? "bg-surface-active" : inRange ? "bg-surface-hover" : ""}`}
                style={{ left: colW * i + 2, width: colW - 4, height: H }}
              >
                <svg width={colW - 4} height={H} aria-hidden className="block">
                  {ORDER.map((c) => {
                    const h = sc(y.totals[c]);
                    if (h <= 0) return null;
                    stackTop -= h;
                    return (
                      <rect
                        key={c}
                        x={(colW - 4) / 2 - bw / 2}
                        y={stackTop}
                        width={bw}
                        height={h}
                        rx={2}
                        fill={TONE[c]}
                      />
                    );
                  })}
                  <text
                    x={(colW - 4) / 2}
                    y={stackTop - 5}
                    textAnchor="middle"
                    className="font-mono text-xs tabular-nums"
                    fill="var(--foreground)"
                  >
                    {y.totals.total > 0 ? Math.round(y.totals.total).toLocaleString("en-US") : ""}
                  </text>
                  <text
                    x={(colW - 4) / 2}
                    y={BASE + 16}
                    textAnchor="middle"
                    className="label-caps"
                    fill={selected ? "var(--foreground)" : "var(--muted-foreground)"}
                  >
                    {`${y.year}${y.partial ? "*" : ""}`}
                  </text>
                  {ch != null && (
                    <text
                      x={(colW - 4) / 2}
                      y={BASE + 32}
                      textAnchor="middle"
                      className="font-mono text-xs tabular-nums"
                      fill={ch >= 0 ? "var(--gain)" : "var(--loss)"}
                    >
                      {`${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%`}
                    </text>
                  )}
                </svg>
              </button>
            );
          })}
          {goal.kind === "line" && (
            <svg
              width={width}
              height={H}
              aria-hidden
              className="pointer-events-none absolute inset-0"
            >
              <line
                data-goal
                x1={0}
                x2={width}
                y1={BASE - sc(goal.amount)}
                y2={BASE - sc(goal.amount)}
                stroke="var(--income)"
                strokeDasharray="4 4"
              />
              <text
                x={4}
                y={BASE - sc(goal.amount) - 5}
                className="label-caps"
                fill="var(--income)"
              >
                {goal.label}
              </text>
            </svg>
          )}
        </div>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {goal.kind === "caption" && <span className="mr-3">{goal.text}</span>}
        {partial && "* part year — no change is shown beside it. "}
        Click a year to go there.
      </p>
    </div>
  );
}
