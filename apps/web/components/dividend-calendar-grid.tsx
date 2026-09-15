"use client";

import * as React from "react";
import Link from "next/link";
import { Popover, PopoverTrigger, PopoverContent } from "@sage/ui";
import type { CalendarEvent, CalendarStatus } from "../lib/dividend-events";
import { sumIncome } from "../lib/dividend-year";
import { formatMoney, formatMoneyWhole } from "../lib/format";

export type { CalendarStatus };

/** `YYYY-MM-DD` for a Date, in LOCAL time — never `toISOString()`, which
 *  converts to UTC and reports the wrong day for anyone east or west of UTC
 *  near midnight. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface DividendCalendarGridProps {
  /** Every payment, already built. Given rather than derived so the grid and
   *  the page cannot disagree: they ran `buildCalendarEvents` over the same
   *  props twice, and the stepper's clamp then depended on a `bounds` computed
   *  separately from the one the page's year picker offers options from. Two
   *  derivations of one invariant, in two files, with no test between them.
   *  This also makes the interface match `DividendList`'s. */
  events: CalendarEvent[];
  /** The span of years the page's picker offers, so stepping past the end of a
   *  year cannot land somewhere the picker does not list. */
  bounds: { first: number; last: number };
  initialDate?: Date;
  viewDate?: Date;
  onViewDateChange?: (d: Date) => void;
  /** Symbol → forward yield %, shown beside each day card's income. */
  yieldBySymbol?: Map<string, number>;
  /** When set, only events whose type is in the set are shown. Absent = all. */
  activeStatuses?: Set<CalendarStatus>;
}

export function DividendCalendarGrid({
  events: allEvents,
  bounds,
  initialDate,
  viewDate: controlledDate,
  onViewDateChange,
  yieldBySymbol,
  activeStatuses,
}: DividendCalendarGridProps) {
  const [internalDate, setInternalDate] = React.useState(() => initialDate ?? new Date());
  const viewDate = controlledDate ?? internalDate;
  const setViewDate = (updater: (d: Date) => Date) => {
    const next = updater(viewDate);
    if (onViewDateChange) onViewDateChange(next);
    else setInternalDate(next);
  };
  const month = viewDate.getMonth();
  const year = viewDate.getFullYear();

  // A fresh Date each render is a new object every time, which would defeat the
  // memos keyed on it; pinning one at mount instead goes stale in a tab left
  // open past midnight. Key on the day string: recomputing it every render is
  // free, it is stable by value, and a new Date appears only when the day
  // actually turns over.
  const todayStr = dayKey(new Date());

  // Only a lookup by day — the events themselves, and the paid/announced call
  // their `type` encodes, are the caller's.
  const eventsByDate = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of allEvents) {
      const list = map.get(e.date);
      if (list) list.push(e);
      else map.set(e.date, [e]);
    }
    return map;
  }, [allEvents]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = firstDay === 0 ? 6 : firstDay - 1;

  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = i - offset + 1;
    if (day < 1 || day > daysInMonth) return null;
    return day;
  });

  const monthLabel = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Stepping stays clamped to the span the page's picker offers, so the two
  // controls cannot disagree about which years exist.
  const atFirst = year <= bounds.first && month === 0;
  const atLast = year >= bounds.last && month === 11;

  function step(delta: number) {
    setViewDate((d) => {
      const candidate = new Date(d.getFullYear(), d.getMonth() + delta, 1);
      const y = candidate.getFullYear();
      return y < bounds.first || y > bounds.last ? d : candidate;
    });
  }

  // The figure beside the label, at the label's own scope: the month in view.
  const monthEvents = React.useMemo(() => {
    const result: CalendarEvent[] = [];
    for (const [dateStr, events] of eventsByDate) {
      if (dateStr.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) {
        for (const e of events) {
          if (activeStatuses && !activeStatuses.has(e.type)) continue;
          result.push(e);
        }
      }
    }
    return result;
  }, [eventsByDate, year, month, activeStatuses]);

  // `sumIncome` returns `null` when the month's events do not share one
  // currency — a total that cannot be computed honestly is not shown, though
  // the pill itself still appears (it renders "—") whenever the month has
  // events at all.
  const monthTotal = React.useMemo(
    () => sumIncome(monthEvents.map((e) => ({ income: e.income, currency: e.currency }))),
    [monthEvents],
  );

  return (
    <div>
      {/* Navigation. Six controls plus the total pill is ~550px of content and
          this row sits OUTSIDE the day grid's overflow-x-auto, so unwrapped it
          pushes the whole card wider than a 375px phone rather than scrolling.
          It wraps instead, and `min-w-0` lets the control group shrink — a flex
          child defaults to min-width:auto and would otherwise refuse to. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={atFirst}
            aria-label="Previous"
            className="rounded-control p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="m15 19-7-7 7-7" />
            </svg>
          </button>
          <span className="min-w-45 text-center font-display text-lg font-medium">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={atLast}
            aria-label="Next"
            className="rounded-control p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>
        </div>
        {(monthTotal ? monthTotal.total > 0 : monthEvents.length > 0) && (
          <span
            data-testid="calendar-header-total"
            className="rounded-full bg-surface-active px-3 py-1 font-mono text-sm font-medium text-foreground"
          >
            {monthTotal && monthTotal.currency
              ? `+${formatMoney({ amount: monthTotal.total.toFixed(2), currency: monthTotal.currency })}`
              : "—"}
          </span>
        )}
      </div>

      {/* A month is seven columns whatever the screen: grid-cols-7 uses
          minmax(0,1fr), so at 375px the cells silently shrink to 37px against a
          128px min-height and the payment chips inside become unreadable rather
          than overflowing where anything would notice. */}
      <div className="overflow-x-auto">
        {/* One bordered, rounded, clipping shell around both grids — each grid
            used to round and border itself independently, which left the
            grid's own square-cornered cells unclipped past the border radius
            at all four corners. */}
        <div className="min-w-[36rem] overflow-hidden rounded-card">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-px bg-border">
            {DAY_LABELS.map((d) => (
              <div
                key={d}
                className="bg-card px-2 py-2 text-center font-mono text-xs font-medium text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px bg-border">
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={i} className="min-h-40 bg-card/50" />;
              }

              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const events = (eventsByDate.get(dateStr) ?? []).filter(
                (e) => !activeStatuses || activeStatuses.has(e.type),
              );
              const isToday = dateStr === todayStr;
              // `null` when the day's events do not share one currency — the
              // chips below still render their own amounts correctly; only
              // this rolled-up badge is withheld.
              const daySum = sumIncome(
                events.map((e) => ({ income: e.income, currency: e.currency })),
              );

              return (
                <div
                  key={i}
                  className={`min-h-40 bg-card p-2 ${isToday ? "bg-surface-hover" : ""}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    {/* Today is structure, not data — which day it is says
                        nothing about the money — so the marker is a foreground
                        pill rather than a sage one (DESIGN.md §1). */}
                    <span
                      data-today={isToday ? "" : undefined}
                      className={`font-mono text-sm ${
                        isToday
                          ? "flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background"
                          : "text-muted-foreground"
                      }`}
                    >
                      {day}
                    </span>
                    {(daySum ? daySum.total > 0 : events.length > 0) && (
                      <span className="font-mono text-xs font-medium text-primary">
                        {daySum && daySum.currency
                          ? `+${formatMoneyWhole({ amount: daySum.total.toFixed(2), currency: daySum.currency })}`
                          : "—"}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {events.map((event, j) => (
                      <Popover key={`${event.symbol}-${j}`}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            data-status={event.type}
                            className={`w-full cursor-pointer rounded-control px-2 py-1.5 text-left text-xs ${
                              event.type === "paid"
                                ? "border border-certainty-paid-border bg-certainty-paid"
                                : event.type === "announced"
                                  ? "border border-certainty-confirmed-border"
                                  : "border border-dashed border-certainty-estimated-border"
                            } ${event.type === "projected" && event.lowConfidence ? "opacity-65" : ""}`}
                          >
                            <div className="font-mono text-xs font-semibold">
                              {event.symbol.split(".")[0]}
                            </div>
                            <div className="mt-0.5 font-mono text-sm font-medium">
                              {event.estimated ? "~" : ""}
                              {event.currency
                                ? formatMoney({ amount: event.income, currency: event.currency })
                                : "—"}
                            </div>
                            {yieldBySymbol?.has(event.symbol) && (
                              <div className="font-mono text-xs text-income">
                                {yieldBySymbol.get(event.symbol)!.toFixed(2)}%
                              </div>
                            )}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-96 p-5">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-sm font-semibold">{event.symbol}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {event.name}
                            </span>
                          </div>
                          <div data-popover-status className="mt-1 text-xs text-muted-foreground">
                            {event.type === "paid"
                              ? "Paid"
                              : event.type === "announced"
                                ? "Confirmed"
                                : event.lowConfidence
                                  ? "Low confidence"
                                  : "Estimated"}
                          </div>
                          <div className="mt-4 grid grid-cols-4 gap-2">
                            {(
                              [
                                ["Declared", event.declarationDate, false],
                                ["Ex-div", event.exDate, false],
                                ["Record", event.recordDate, false],
                                ["Paid", event.paymentDate, event.estimated ?? false],
                              ] as const
                            ).map(([label, date, est]) => (
                              <div key={label} className="text-center">
                                <div
                                  className={`mx-auto mb-1.5 h-2 w-2 rounded-full ${date ? "bg-certainty-paid-border" : "border border-certainty-estimated-border"}`}
                                />
                                <div data-chain-label className="label-caps text-muted-foreground">
                                  {label}
                                </div>
                                <div data-chain-date className="mt-0.5 font-mono text-xs">
                                  {date ? `${est ? "~" : ""}${date}` : "—"}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-4 space-y-1.5 border-t border-border pt-3 font-mono text-xs">
                            {event.amountPerShare != null && (
                              <div className="flex justify-between">
                                <span className="font-body text-muted-foreground">Per share</span>
                                <span>
                                  {event.amountPerShare} {event.currency}
                                </span>
                              </div>
                            )}
                            {event.shares != null && (
                              <div className="flex justify-between">
                                <span className="font-body text-muted-foreground">Shares</span>
                                <span>{event.shares}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="font-body text-muted-foreground">Income</span>
                              <span className="text-primary">
                                {event.estimated ? "~" : ""}
                                {event.currency
                                  ? formatMoney({
                                      amount: event.income,
                                      currency: event.currency,
                                    })
                                  : "—"}
                              </span>
                            </div>
                          </div>
                          <Link
                            href={`/asset/${event.symbol}`}
                            className="mt-4 inline-block text-xs text-primary hover:underline"
                          >
                            View {event.symbol} →
                          </Link>
                        </PopoverContent>
                      </Popover>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
