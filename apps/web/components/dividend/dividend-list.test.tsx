import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { groupListRows, DividendList } from "./dividend-list";
import type { CalendarEvent, CalendarStatus } from "../../lib/dividend-events";

const ALL: Set<CalendarStatus> = new Set(["paid", "announced", "projected"]);

function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    date: "2026-08-14",
    symbol: "O",
    name: "Realty Income Corporation",
    income: "5.42",
    currency: "USD",
    type: "paid",
    amountPerShare: "0.271",
    shares: "20",
    declarationDate: null,
    exDate: "2026-07-31",
    recordDate: null,
    paymentDate: "2026-08-14",
    ...over,
  };
}

describe("groupListRows", () => {
  it("keeps only the given year and groups by month with a subtotal", () => {
    const groups = groupListRows(
      [
        ev({ date: "2026-08-14", income: "5.42" }),
        ev({ date: "2026-08-20", income: "2.73", symbol: "MSFT" }),
        ev({ date: "2026-09-15", income: "3.31" }),
        ev({ date: "2025-08-14", income: "99.00" }),
      ],
      2026,
      ALL,
    );
    expect(groups.map((g) => g.month)).toEqual(["2026-08", "2026-09"]);
    // Two DIFFERENT subtotals: identical ones (5.42 + 2.73 also makes 8.15)
    // pass even if both assertions read the same group.
    expect(groups[0]!.sum!.total).toBeCloseTo(8.15);
    expect(groups[0]!.rows).toHaveLength(2);
    expect(groups[1]!.sum!.total).toBeCloseTo(3.31);
    expect(groups[1]!.rows).toHaveLength(1);
  });

  it("omits a month with no payments rather than showing an empty section", () => {
    const groups = groupListRows([ev({ date: "2026-03-14" })], 2026, ALL);
    expect(groups.map((g) => g.month)).toEqual(["2026-03"]);
  });

  it("filters by status and reduces the subtotal to match", () => {
    // The bug worth guarding: rows disappear but the subtotal does not follow.
    const events = [
      ev({ date: "2026-08-14", income: "5.42", type: "paid" }),
      ev({ date: "2026-08-20", income: "2.73", type: "projected" }),
    ];
    const paidOnly = groupListRows(events, 2026, new Set<CalendarStatus>(["paid"]));
    expect(paidOnly[0]!.rows).toHaveLength(1);
    expect(paidOnly[0]!.sum!.total).toBeCloseTo(5.42);
  });

  it("refuses to sum a month whose rows carry different currencies", () => {
    const events = [
      ev({ date: "2026-08-14", income: "5.42", currency: "USD" }),
      ev({ date: "2026-08-20", income: "100.00", currency: "DKK", symbol: "MSFT" }),
    ];
    const groups = groupListRows(events, 2026, ALL);
    expect(groups[0]!.sum).toBeNull();
    // The rows themselves are untouched — only the subtotal is withheld.
    expect(groups[0]!.rows).toHaveLength(2);
  });

  it("orders rows inside a month by date", () => {
    const groups = groupListRows(
      [ev({ date: "2026-08-20", symbol: "MSFT" }), ev({ date: "2026-08-14", symbol: "O" })],
      2026,
      ALL,
    );
    expect(groups[0]!.rows.map((r) => r.symbol)).toEqual(["O", "MSFT"]);
  });
});

describe("DividendList", () => {
  it("renders a month heading with its subtotal and the row arithmetic", () => {
    render(<DividendList events={[ev()]} year={2026} statuses={ALL} />);
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.getByTestId("month-total-2026-08")).toHaveTextContent("$5.42");
    // shares × per-share is what makes a payment checkable against a statement.
    expect(screen.getByText("20 × $0.271")).toBeInTheDocument();
  });

  // This is the view a phone OPENS on, chosen because the calendar can only be
  // read sideways — so it must not itself need sideways dragging to reach the
  // money. jsdom cannot measure; the 375px numbers are in the browser check on
  // this task's findings. What is guarded here is the structure those numbers
  // depend on.
  it("fits a phone: no min-width floor below sm, and the widest column drops out", () => {
    const { container } = render(<DividendList events={[ev()]} year={2026} statuses={ALL} />);

    // The 34rem (544px) floor forced 201px of the row off a 343px phone. It
    // only applies from sm up now.
    const port = container.querySelector(".overflow-x-auto")!;
    const inner = port.firstElementChild as HTMLElement;
    expect(inner.className).toContain("sm:min-w-[34rem]");
    expect(inner.className).not.toMatch(/(^|\s)min-w-\[34rem\]/);

    // Five columns below sm, six from sm up — one implementation, not a
    // separate stacked layout.
    const row = container.querySelector("[data-testid='month-section-2026-08'] .grid")!;
    expect(row.className).toContain("grid-cols-[3.5rem_3rem_1fr_5rem_5.5rem]");
    expect(row.className).toContain("sm:grid-cols-[4.5rem_5rem_1fr_7rem_5rem_5.5rem]");

    // shares × per-share is the widest inflexible column and the least
    // essential on a phone, so it is the one that goes.
    const shares = screen.getByText("20 × $0.271");
    expect(shares.className).toContain("hidden");
    expect(shares.className).toContain("sm:block");
    // The income and its status are not hidden at any width.
    const income = row.children[4] as HTMLElement;
    expect(income).toHaveTextContent("$5.42");
    expect(income.className).not.toContain("hidden");
    expect((row.children[5] as HTMLElement).className).not.toContain("hidden");
  });

  it("says so plainly when the selected year has no payments", () => {
    render(<DividendList events={[]} year={2026} statuses={ALL} />);
    expect(screen.getByText(/no payments in 2026/i)).toBeInTheDocument();
  });

  it("marks the current month when the selected year is the current one", () => {
    // The old list opened on the oldest payment in the portfolio. Bounded by
    // year it now opens on January, which is the same complaint in miniature —
    // so "now" is marked, and scrolled to on first mount.
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    render(
      <DividendList
        events={[ev({ date: `${thisMonth}-14` })]}
        year={now.getFullYear()}
        statuses={ALL}
      />,
    );
    expect(screen.getByTestId(`month-section-${thisMonth}`)).toHaveAttribute(
      "data-current",
      "true",
    );
  });

  // Keyed `[]` the effect never re-ran, so coming back from 2025 to the
  // current year left the list wherever 2025 had been scrolled to — the same
  // "opens on the least useful row" complaint the year bound was meant to fix.
  it("brings the current month back into view when the year changes", () => {
    const scrollIntoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    try {
      const now = new Date();
      const thisYear = now.getFullYear();
      const thisMonth = `${thisYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const events = [ev({ date: `${thisMonth}-14` }), ev({ date: `${thisYear - 1}-08-14` })];

      const { rerender } = render(<DividendList events={events} year={thisYear} statuses={ALL} />);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      // Another year has no current month, so nothing is scrolled to.
      rerender(<DividendList events={events} year={thisYear - 1} statuses={ALL} />);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      // …and coming back re-runs it.
      rerender(<DividendList events={events} year={thisYear} statuses={ALL} />);
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    } finally {
      scrollIntoView.mockRestore();
    }
  });

  it("marks no month as current when looking at another year", () => {
    const lastYear = new Date().getFullYear() - 1;
    render(
      <DividendList events={[ev({ date: `${lastYear}-08-14` })]} year={lastYear} statuses={ALL} />,
    );
    expect(screen.getByTestId(`month-section-${lastYear}-08`)).not.toHaveAttribute(
      "data-current",
      "true",
    );
  });

  it("shows a dash instead of a month subtotal that mixes currencies", () => {
    render(
      <DividendList
        events={[
          ev({ date: "2026-08-14", income: "5.42", currency: "USD" }),
          ev({ date: "2026-08-20", income: "100.00", currency: "DKK", symbol: "MSFT" }),
        ]}
        year={2026}
        statuses={ALL}
      />,
    );
    // Both rows still render their own amounts; only the sum is withheld.
    expect(screen.getByTestId("month-total-2026-08")).toHaveTextContent("—");
    expect(screen.getByText("$5.42")).toBeInTheDocument();
    expect(screen.getByText(/DKK.*100/)).toBeInTheDocument();
  });
});
