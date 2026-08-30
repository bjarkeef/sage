"use client";

import * as React from "react";
import Link from "next/link";
import { Chip } from "@sage/ui";
import type { CalendarEvent, CalendarStatus } from "../../lib/dividend-events";
import { sumIncome } from "../../lib/dividend-year";
import { formatMoney } from "../../lib/format";

export interface ListMonth {
  month: string; // YYYY-MM
  /** `null` when the month's rows do not share one currency — a subtotal
   *  cannot be computed honestly, so the section header renders "—" instead. */
  sum: { total: number; currency: string } | null;
  rows: CalendarEvent[];
}

/** The selected year's payments, grouped into month sections with a subtotal.
 *
 *  Bounded and filtered on purpose: this replaced a flat table of every
 *  payment ever recorded, sorted oldest first, which opened on the least
 *  useful row in the portfolio and ignored the calendar's status filters
 *  entirely. */
export function groupListRows(
  events: CalendarEvent[],
  year: number,
  statuses: Set<CalendarStatus>,
): ListMonth[] {
  const byMonth = new Map<string, CalendarEvent[]>();

  for (const e of events) {
    if (!e.date.startsWith(`${year}-`)) continue;
    if (!statuses.has(e.type)) continue;
    const month = e.date.slice(0, 7);
    const rows = byMonth.get(month) ?? [];
    rows.push(e);
    byMonth.set(month, rows);
  }

  return [...byMonth.entries()]
    .map(([month, rows]) => ({
      month,
      rows: [...rows].sort((a, b) => a.date.localeCompare(b.date)),
      sum: sumIncome(rows.map((r) => ({ income: r.income, currency: r.currency }))),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

const STATUS_LABEL: Record<CalendarStatus, string> = {
  paid: "Paid",
  announced: "Confirmed",
  projected: "Estimated",
};

function StatusChip({ status }: { status: CalendarStatus }) {
  const cls =
    status === "paid"
      ? "border-certainty-paid-border bg-certainty-paid text-foreground/80"
      : status === "announced"
        ? "border-certainty-confirmed-border text-foreground/80"
        : "border-dashed border-certainty-estimated-border text-muted-foreground";
  return (
    <Chip variant="outline" className={cls}>
      {STATUS_LABEL[status]}
    </Chip>
  );
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function DividendList({
  events,
  year,
  statuses,
}: {
  events: CalendarEvent[];
  year: number;
  statuses: Set<CalendarStatus>;
}) {
  const groups = groupListRows(events, year, statuses);

  const now = new Date();
  // Only meaningful when the selected year IS the current year; in any other
  // year no month is "now".
  const currentMonth =
    year === now.getFullYear() ? `${year}-${String(now.getMonth() + 1).padStart(2, "0")}` : null;

  const currentRef = React.useRef<HTMLElement | null>(null);
  // Bounded by year, the list opens on January — which is the same "opens on
  // the least useful row" problem the unbounded table had. Bring the current
  // month into view whenever the YEAR changes, which includes mount. Keyed on
  // `[]` it never re-ran, so coming back from 2025 to the current year left
  // the list wherever 2025 had been scrolled to. A filter toggle is a
  // different event and deliberately does not re-scroll: that would yank the
  // page out from under someone who has scrolled away.
  React.useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "start" });
  }, [year]);

  if (groups.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No payments in {year}.</p>;
  }

  // Empty currency throws a RangeError out of Intl.NumberFormat.
  const money = (n: number, currency: string) =>
    currency ? formatMoney({ amount: n.toFixed(2), currency }) : "—";

  // A month's subtotal has a second, distinct reason it may be unrenderable:
  // `sum` is `null` when the month's rows do not share one currency, not just
  // when a currency is missing.
  const subtotalMoney = (sum: { total: number; currency: string } | null) =>
    sum ? money(sum.total, sum.currency) : "—";

  // A per-share price has to read back at the precision it was declared at —
  // rounding $0.271 to $0.27 (formatMoney's default 2dp) breaks the "does
  // this match my statement" check this line exists for. Widens the fraction
  // digits to whatever the source string carries, never below 2dp.
  const perShareMoney = (amount: string, currency: string) => {
    if (!currency) return "—";
    const dot = amount.indexOf(".");
    const decimals = Math.max(2, dot === -1 ? 0 : amount.length - dot - 1);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(amount));
  };

  return (
    <div className="overflow-x-auto">
      {/* Below sm the rows carry no floor of their own: the five remaining
          columns measure 304px against the 343px a 375px phone leaves inside
          PageShell's px-4, so the whole row — the income and its status
          included — is on screen without dragging. This is the view a phone
          OPENS on precisely because the calendar can only be read sideways; a
          34rem floor here made it the same thing it was chosen to avoid. */}
      <div className="sm:min-w-[34rem]">
        {groups.map((g) => (
          <section
            key={g.month}
            ref={g.month === currentMonth ? currentRef : undefined}
            data-testid={`month-section-${g.month}`}
            data-current={g.month === currentMonth ? "true" : undefined}
            className="mb-2 scroll-mt-4"
          >
            <div className="flex items-baseline justify-between border-b border-border py-2">
              <h3 className="text-sm font-medium">
                {monthLabel(g.month)}
                {g.month === currentMonth && (
                  <span className="ml-2 text-xs font-normal text-primary">this month</span>
                )}
              </h3>
              <span
                data-testid={`month-total-${g.month}`}
                className="font-mono text-sm tabular-nums text-income"
              >
                {subtotalMoney(g.sum)}
              </span>
            </div>

            {g.rows.map((r, i) => (
              <div
                key={`${r.symbol}-${r.date}-${i}`}
                className="grid grid-cols-[3.5rem_3rem_1fr_5rem_5.5rem] items-center gap-2 border-b border-hairline py-2 text-sm last:border-b-0 sm:grid-cols-[4.5rem_5rem_1fr_7rem_5rem_5.5rem] sm:gap-3"
              >
                <span className="font-mono tabular-nums text-muted-foreground">
                  {new Date(`${r.date}T00:00:00`).toLocaleDateString("en-US", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <Link href={`/asset/${r.symbol}`} className="font-mono font-medium hover:underline">
                  {r.symbol.split(".")[0]}
                </Link>
                <span className="truncate text-muted-foreground">{r.name}</span>
                {/* The widest inflexible column (7rem) and the least
                    essential on a phone: it exists to check a payment against
                    a statement, which is a desk task. Hidden below sm so the
                    income and its status fit on screen instead. */}
                <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground sm:block">
                  {r.shares && r.amountPerShare
                    ? `${r.shares} × ${perShareMoney(r.amountPerShare, r.currency)}`
                    : "—"}
                </span>
                <span className="text-right font-mono tabular-nums">
                  {money(Number(r.income), r.currency)}
                </span>
                <span className="text-right">
                  <StatusChip status={r.type} />
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
