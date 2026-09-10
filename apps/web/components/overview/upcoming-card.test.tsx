import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpcomingCard, upcomingWindowLabel } from "./upcoming-card";
import type { UpcomingRow } from "../../lib/types";

/** n days from the moment the suite runs, in UTC — never a literal date, so
 *  this file can't rot into a past-dated fixture (see CLAUDE.md's
 *  self-expiring-tests note). */
function fromToday(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const TODAY = fromToday(0);

function row(symbol: string, date: string, over: Partial<UpcomingRow> = {}): UpcomingRow {
  return {
    symbol,
    name: `${symbol} Inc`,
    date,
    income: "10.00",
    currency: "USD",
    dateEstimated: false,
    projected: false,
    ...over,
  };
}

describe("upcomingWindowLabel", () => {
  it("says 30 days when every visible row fits inside the normal window", () => {
    const rows = [row("A", fromToday(5)), row("B", fromToday(20))];
    expect(upcomingWindowLabel(rows, TODAY)).toBe("next 30 days");
  });

  it("reflects the true span when a row reaches past the 30-day window", () => {
    // Mirrors `selectUpcoming`'s MIN_ROWS fallback (dashboard.ts): a
    // sparsely-scheduled book can surface a payment 45+ days out, and the
    // caption must not keep claiming "30 days" once that happens.
    const rows = [row("A", fromToday(5)), row("B", fromToday(45))];
    expect(upcomingWindowLabel(rows, TODAY)).toBe("next 45 days");
  });

  it("falls back to 30 days for an empty row set", () => {
    expect(upcomingWindowLabel([], TODAY)).toBe("next 30 days");
  });
});

describe("UpcomingCard", () => {
  it("labels the window truthfully when a fallback row reaches past 30 days", () => {
    const upcoming = [row("A", fromToday(5)), row("B", fromToday(45))];
    render(<UpcomingCard upcoming={upcoming} todayISO={TODAY} taxRate={null} />);
    expect(screen.getByText("next 45 days")).toBeInTheDocument();
    expect(screen.queryByText("next 30 days")).not.toBeInTheDocument();
  });

  it("keeps the normal 30-day caption when nothing reaches past it", () => {
    const upcoming = [row("A", fromToday(5))];
    render(<UpcomingCard upcoming={upcoming} todayISO={TODAY} taxRate={null} />);
    expect(screen.getByText("next 30 days")).toBeInTheDocument();
  });
});
