// apps/web/components/dividend-income-bars.tsx
"use client";

import type { MonthlyBreakdownDTO } from "../lib/types";
import { filterMonthlyBreakdown, monthsOfYear, sumIncome } from "../lib/dividend-year";
import type { CalendarStatus } from "../lib/dividend-events";
import { CERTAINTY_FILL, CertaintyBarsLegend } from "./charts/certainty-bars";

interface DividendIncomeBarsProps {
  data: MonthlyBreakdownDTO[];
  year: number; // the calendar year to chart
  currentMonth: string; // YYYY-MM of today — marks the current column
  selectedMonth?: string; // YYYY-MM of the month currently viewed in the calendar
  payersByMonth?: Map<string, number>; // distinct holdings paying in each month
  /** When set, deselected series are zeroed before anything is measured.
   *  Absent = all three. */
  activeStatuses?: Set<CalendarStatus>;
  onMonthSelect?: (month: string) => void;
}

export function DividendIncomeBars({
  data,
  year,
  currentMonth,
  selectedMonth,
  payersByMonth,
  activeStatuses,
  onMonthSelect,
}: DividendIncomeBarsProps) {
  const windowMonths = monthsOfYear(year);
  const dataByMonth = new Map(data.map((d) => [d.month, d]));
  const defaultCurrency = data[0]?.currency ?? "USD";

  // Zeroed FIRST, so the heights, the value labels, the tooltips and the
  // average line are all measured against the same filtered figures the list
  // and the summary band answer to.
  const months: MonthlyBreakdownDTO[] = filterMonthlyBreakdown(
    windowMonths.map(
      (month) =>
        dataByMonth.get(month) ?? {
          month,
          retroactive: "0",
          announced: "0",
          projected: "0",
          currency: defaultCurrency,
        },
    ),
    activeStatuses,
  );

  const values = months.map(
    (d) => Number(d.retroactive) + Number(d.announced) + Number(d.projected),
  );
  const max = Math.max(...values, 1);
  // Each bar's own figure is honest — every row is pre-aggregated into one
  // currency by the API. The average line is not: it sums twelve MONTHS
  // together, and in the FX-incomplete state those months do not all share a
  // currency (the same reason `yearProgress` withholds its total). `sumIncome`
  // both computes the sum and catches that conflict; when it does, the line
  // has nothing honest to show, so it is not drawn at all rather than
  // rendered at a position derived from adding DKK to USD.
  const monthSum = sumIncome(
    months.map((d) => ({
      income: String(Number(d.retroactive) + Number(d.announced) + Number(d.projected)),
      currency: d.currency,
    })),
  );
  const avg = monthSum ? monthSum.total / 12 : 0;
  const avgPercent = max > 0 ? 100 - (avg / max) * 100 : 100;

  return (
    <div>
      <div className="relative">
        {monthSum && avg > 0 && (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-primary/40"
            style={{ top: `calc(${avgPercent}% + 10px)` }}
          >
            <span className="absolute -top-3 right-0 font-mono text-xs text-primary/60">avg</span>
          </div>
        )}
        <div className="flex items-end gap-1.5" style={{ height: 160 }}>
          {months.map((d) => {
            const retroVal = Number(d.retroactive);
            const annVal = Number(d.announced);
            const projVal = Number(d.projected);
            const total = retroVal + annVal + projVal;
            const height = total > 0 ? Math.round((total / max) * 120) + 6 : 6;
            const retroHeight = total > 0 ? Math.round((retroVal / total) * height) : 0;
            const annHeight =
              total > 0 ? Math.min(Math.round((annVal / total) * height), height - retroHeight) : 0;
            const projHeight = total > 0 ? height - retroHeight - annHeight : 0;
            const isCurrent = d.month === currentMonth;
            const isSelected = d.month === selectedMonth;
            // No year on the January tick: every column belongs to the year
            // the picker names, so a "Jan '26" here would imply a boundary
            // this chart cannot cross. It carried one while the window rolled.
            const monthDate = new Date(d.month + "-01T00:00:00Z");
            const label = monthDate.toLocaleDateString("en-US", {
              month: "short",
              timeZone: "UTC",
            });
            // "2 payers" is distinct holdings, not payments — two payments from
            // one holding is one payer. It read at rest in the year grid this
            // chart replaces, so the tooltip is where it survives.
            const payers = payersByMonth?.get(d.month) ?? 0;
            const payerNote = payers > 0 ? `, ${payers} payer${payers === 1 ? "" : "s"}` : "";
            const tooltip = `${d.month}: paid ${retroVal.toFixed(2)}, confirmed ${annVal.toFixed(2)}, estimated ${projVal.toFixed(2)} ${d.currency}${payerNote}`;

            return (
              <button
                type="button"
                key={d.month}
                title={tooltip}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onMonthSelect?.(d.month)}
                className={`flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-control border-0 p-0 pb-0.5 ${isSelected ? "bg-surface-active ring-1 ring-inset ring-primary/60" : "bg-transparent"}`}
              >
                {total > 0 && (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {Math.round(total)}
                  </span>
                )}
                <div className="flex w-full flex-col" style={{ height }}>
                  {projHeight > 0 && (
                    <div
                      data-seg="estimated"
                      className="w-full rounded-t-badge border border-dashed border-certainty-estimated-border"
                      style={{ height: projHeight, background: CERTAINTY_FILL.estimated }}
                    />
                  )}
                  {annHeight > 0 && (
                    <div
                      data-seg="confirmed"
                      className={`w-full ${projHeight === 0 ? "rounded-t-badge" : ""} ${retroHeight === 0 ? "rounded-b-badge" : ""}`}
                      style={{ height: annHeight, background: CERTAINTY_FILL.confirmed }}
                    />
                  )}
                  {retroHeight > 0 && (
                    <div
                      data-seg="paid"
                      className={`w-full ${projHeight === 0 && annHeight === 0 ? "rounded-t-badge" : ""} rounded-b-badge`}
                      style={{ height: retroHeight, background: CERTAINTY_FILL.paid }}
                    />
                  )}
                  {total === 0 && (
                    <div className="w-full rounded-badge bg-muted/30" style={{ height: 6 }} />
                  )}
                </div>
                <span
                  className={`whitespace-nowrap font-mono text-xs ${
                    isSelected
                      ? "font-semibold text-foreground"
                      : isCurrent
                        ? "font-medium text-primary"
                        : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <CertaintyBarsLegend />
    </div>
  );
}
