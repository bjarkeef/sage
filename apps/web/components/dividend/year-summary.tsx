"use client";

import { Card } from "@sage/ui";
import type { YearProgress } from "../../lib/dividend-year";
import { daysInYear } from "../../lib/dividend-year";
import { formatMoney } from "../../lib/format";

/**
 * The calendar page's summary, scoped to the selected year.
 *
 * Deliberately NOT called "annual income": Analytics owns that name for a
 * different quantity — a fixed forward-twelve-month run rate. This figure is
 * whatever the selected window pays, so reusing the label would leave two
 * adjacent pages showing different numbers under one word.
 *
 * Monthly and Daily carry no information the hero does not; they are the total
 * over twelve and over the year's days, kept because a per-day figure is
 * legible in a way an annual one is not.
 *
 * No in-card link to Analytics: the sidebar already carries a Dividends >
 * Analytics entry, and a second one here just floated beside numbers it has
 * no relationship to.
 */
export function YearSummary({ progress, year }: { progress: YearProgress; year: number }) {
  // Two distinct reasons a figure may be unrenderable, both guarded: no
  // currency means no income data at all — a first run before the first
  // sync, or an FX outage that filtered every row out — and formatting money
  // against an empty currency code throws a RangeError, white-screening the
  // page. `mixedCurrency` means the opposite problem: there IS data, but the
  // year's months do not agree on a currency, so summing them would add DKK
  // to USD and label the result with whichever came first. Both render "—".
  const money = (n: number) =>
    !progress.mixedCurrency && progress.currency
      ? formatMoney({ amount: n.toFixed(2), currency: progress.currency })
      : "—";

  const rows: Array<{ id: string; label: string; value: number; accent?: boolean }> = [
    { id: "year-monthly", label: "Monthly", value: progress.total / 12 },
    { id: "year-daily", label: "Daily", value: progress.total / daysInYear(year) },
  ];
  // A fully past year has nothing still coming; a $0.00 row says nothing. Nor
  // does a row repeating the hero: on any FUTURE year every month is ahead, so
  // `expected` IS the total, and the band printed one figure twice under two
  // labels.
  if (progress.expected > 0 && progress.expected !== progress.total) {
    rows.push({
      id: "year-expected",
      label: "Yet to receive",
      value: progress.expected,
      accent: true,
    });
  }

  return (
    <Card className="flex flex-col gap-5">
      <div>
        <div className="label-caps text-muted-foreground">{year}</div>
        <div data-testid="year-total" className="stat-num mt-1">
          {money(progress.total)}
        </div>
      </div>

      <dl className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-baseline justify-between gap-6 border-b border-hairline pb-1.5 last:border-b-0"
          >
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd
              data-testid={row.id}
              className={`font-mono text-sm tabular-nums ${row.accent ? "text-income" : ""}`}
            >
              {money(row.value)}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
