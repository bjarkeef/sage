"use client";

import * as React from "react";
import { BasisChip, Card, CardTitle } from "@sage/ui";
import type { MonthlyRhythmRow } from "../../lib/dividend-derive";
import { formatMoney } from "../../lib/format";

/**
 * The year as a cycle, because that is what a dividend year is.
 *
 * This was a recharts bar chart of the same twelve numbers. Bars are better for
 * reading one month's value; they are worse at the question this card actually
 * asks, which is *what shape is my year* — and they cannot show the one
 * structural fact about the data, that December runs into January and the whole
 * thing repeats. A ring closes. `DESIGN.md` asks that a structural device
 * encode something true about the content rather than decorate it, and the
 * cycle here is true.
 *
 * The dashed reference circle is what makes it an instrument rather than a
 * pretty polar chart: it sits at the radius every month would reach if the year
 * paid evenly, so "lumpy" becomes a thing you see rather than infer. A book of
 * monthly payers is a disc; a book of four quarterly payers is a cross.
 *
 * `--income-fill` rather than `--income`: gold has two roles and this is an
 * area, not text. The bar chart this replaces filled with the text value, which
 * is the exact misuse tokens.css warns about — it is tuned for 4.5:1 against a
 * card, which on light makes it a brown.
 */

const INITIAL = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SIZE = 240;
const C = SIZE / 2;
/** The hole has to clear the figure standing in it. A formatted total runs to
 *  ~78px at 13px, so it reaches ~39px either side of centre; at the old R0 of
 *  40 the digits sat directly on the wedges. */
const R0 = 56;
const R1 = 100;
/** Month initials, just outside the rim and inside the viewBox (C is 120). */
const LABEL_R = R1 + 11;
/** Half a degree of air between neighbouring wedges, in radians. A ring of
 *  twelve touching wedges reads as one disc with faint scratches in it. */
const GAP = 0.03;

/** The trailing twelve months ending at the latest month present, each with its
 *  total or zero.
 *
 *  `buildMonthlyRhythm` omits months that paid nothing, which is correct for
 *  bars (recharts simply draws fewer) and wrong for a ring: a wedge's ANGLE is
 *  its month, so a missing August cannot be skipped without silently rotating
 *  September into its place. A month that paid nothing is also the single most
 *  informative wedge on a lumpy book. */
function twelveSlots(rows: MonthlyRhythmRow[]): Array<{ key: string; amount: number }> {
  const byMonth = new Map(rows.map((r) => [r.month, r.amount]));
  const latest = rows.reduce((a, r) => (r.month > a ? r.month : a), rows[0]!.month);
  const endY = Number(latest.slice(0, 4));
  const endM = Number(latest.slice(5, 7)) - 1;

  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(endY, endM - 11 + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { key, amount: byMonth.get(key) ?? 0 };
  });
}

function wedge(a0: number, a1: number, r: number): string {
  const p = (ang: number, rad: number) =>
    `${(C + rad * Math.cos(ang)).toFixed(2)} ${(C + rad * Math.sin(ang)).toFixed(2)}`;
  return [
    "M",
    p(a0, R0),
    "L",
    p(a0, r),
    "A",
    r,
    r,
    0,
    0,
    1,
    p(a1, r),
    "L",
    p(a1, R0),
    "A",
    R0,
    R0,
    0,
    0,
    0,
    p(a0, R0),
    "Z",
  ].join(" ");
}

export function MonthlyRhythm({
  rows,
  currency = "USD",
  taxed = false,
}: {
  rows: MonthlyRhythmRow[];
  currency?: string;
  /** Whether the amounts below are net of a configured dividend tax rate —
   *  drives the `BasisChip` in the title row. Optional so this component's
   *  own unit tests (which don't exercise tax) don't need to thread it; the
   *  real caller (`/dividends/analytics`) always passes it explicitly. */
  taxed?: boolean;
}) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  if (rows.length === 0) return null;

  const slots = twelveSlots(rows);
  const total = slots.reduce((a, s) => a + s.amount, 0);
  const max = Math.max(...slots.map((s) => s.amount), 0);
  const even = total / 12;
  const money = (n: number) => formatMoney({ amount: n.toFixed(2), currency });

  // Every radius is measured against the biggest month, so a flat year fills
  // the ring rather than rendering as a thin band nobody can read.
  const radius = (amount: number) => (max > 0 ? R0 + (amount / max) * (R1 - R0) : R0);

  const hoveredSlot = hovered == null ? null : slots[hovered]!;

  return (
    <Card compact className="relative flex h-full flex-col">
      <div className="mb-3.5">
        <CardTitle className="mb-0" meta={<BasisChip taxed={taxed} />}>
          Monthly rhythm
        </CardTitle>
        <div className="min-h-4 text-xs text-muted-foreground">
          {hoveredSlot
            ? `${FULL[Number(hoveredSlot.key.slice(5, 7)) - 1]} ${hoveredSlot.key.slice(0, 4)} · ${money(hoveredSlot.amount)}`
            : "Received per month, last 12"}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-full max-w-72"
          role="img"
          aria-label={`Dividend income for each of the last twelve months, drawn around a circle. Total ${money(total)}; an even year would pay ${money(even)} a month.`}
          onPointerLeave={() => setHovered(null)}
        >
          {/* What an even year would look like. Drawn under the wedges so a
              month that beats it visibly crosses the line. */}
          {max > 0 && (
            <circle
              cx={C}
              cy={C}
              r={radius(even)}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.45}
            />
          )}

          {slots.map((s, i) => {
            const a0 = (i / 12) * Math.PI * 2 - Math.PI / 2 + GAP;
            const a1 = ((i + 1) / 12) * Math.PI * 2 - Math.PI / 2 - GAP;
            const mid = (a0 + a1) / 2;
            const m = Number(s.key.slice(5, 7)) - 1;
            return (
              <g key={s.key}>
                <path
                  d={wedge(a0, a1, radius(s.amount))}
                  fill="var(--income-fill)"
                  opacity={hovered == null || hovered === i ? 0.9 : 0.4}
                  onPointerEnter={() => setHovered(i)}
                >
                  <title>{`${FULL[m]} ${s.key.slice(0, 4)} · ${money(s.amount)}`}</title>
                </path>
                <text
                  x={C + LABEL_R * Math.cos(mid)}
                  y={C + LABEL_R * Math.sin(mid) + 3.5}
                  textAnchor="middle"
                  className="label-caps"
                  fill="var(--muted-foreground)"
                  opacity={hovered === i ? 1 : 0.55}
                >
                  {INITIAL[m]}
                </text>
              </g>
            );
          })}

          <text
            x={C}
            y={C - 2}
            textAnchor="middle"
            className="font-display tabular-nums"
            fill="var(--foreground)"
            fontSize={13}
            fontWeight={400}
          >
            {money(total)}
          </text>
          <text
            x={C}
            y={C + 13}
            textAnchor="middle"
            className="label-caps"
            fill="var(--muted-foreground)"
            opacity={0.7}
          >
            12 MONTHS
          </text>
        </svg>
      </div>

      <p className="mt-2 text-center text-xs text-muted-foreground">
        Dashed ring: {money(even)} a month, if the year paid evenly
      </p>
    </Card>
  );
}
