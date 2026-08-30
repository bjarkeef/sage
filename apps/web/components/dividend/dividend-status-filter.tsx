"use client";

import type { CalendarStatus } from "../dividend-calendar-grid";

const ITEMS: { status: CalendarStatus; label: string; dot: string }[] = [
  { status: "paid", label: "Paid", dot: "border border-certainty-paid-border bg-certainty-paid" },
  { status: "announced", label: "Confirmed", dot: "border border-certainty-confirmed-border" },
  {
    status: "projected",
    label: "Estimated",
    dot: "border border-dashed border-certainty-estimated-border",
  },
];

export interface DividendStatusFilterProps {
  active: Set<CalendarStatus>;
  onToggle: (status: CalendarStatus) => void;
}

/** Clickable Paid/Confirmed/Estimated chips — replaces the static legend. One
 *  hue, three ink weights (filled / outlined / dashed), matching the grid. */
export function DividendStatusFilter({ active, onToggle }: DividendStatusFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ITEMS.map(({ status, label, dot }) => {
        const on = active.has(status);
        return (
          <button
            key={status}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(status)}
            className={`inline-flex items-center gap-2 rounded-full border border-hairline px-3 py-1 text-xs text-foreground transition-opacity hover:bg-surface-hover ${on ? "" : "opacity-40"}`}
          >
            <i className={`h-2.5 w-2.5 rounded-badge ${dot}`} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
