import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DividendIncomeBars } from "./dividend-income-bars";

const breakdown = [
  { month: "2026-06", retroactive: "47.00", announced: "0", projected: "0", currency: "USD" },
  { month: "2026-07", retroactive: "30.00", announced: "20.00", projected: "0", currency: "USD" },
  { month: "2026-12", retroactive: "0", announced: "0", projected: "64.00", currency: "USD" },
];

describe("DividendIncomeBars", () => {
  it("fills each certainty segment (no outline convention on any of them)", () => {
    const { container } = render(
      <DividendIncomeBars data={breakdown} year={2026} currentMonth="2026-07" />,
    );
    const paid = container.querySelector("[data-seg='paid']")!;
    const confirmed = container.querySelector("[data-seg='confirmed']")!;
    const estimated = container.querySelector("[data-seg='estimated']")!;
    expect(paid).toBeTruthy();
    expect(confirmed).toBeTruthy();
    expect(estimated).toBeTruthy();
    // Unified with the analytics forward chart: bars are filled, so the old
    // outline-border classes are gone from paid/confirmed. Estimated's dashed
    // outline is gone too — at real (thin, twelve-bar) scale it read as a row
    // of near-empty boxes, so estimated is a solid fill like the other two.
    expect(paid.className).not.toContain("border-certainty-paid-border");
    expect(confirmed.className).not.toContain("border-certainty-confirmed-border");
    expect(estimated.className).not.toContain("border-dashed");
  });

  it("renders the legend", () => {
    render(<DividendIncomeBars data={breakdown} year={2026} currentMonth="2026-07" />);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("fires onMonthSelect with the clicked bar's YYYY-MM", async () => {
    const user = userEvent.setup();
    const onMonthSelect = vi.fn();
    render(
      <DividendIncomeBars
        data={breakdown}
        year={2026}
        currentMonth="2026-07"
        onMonthSelect={onMonthSelect}
      />,
    );
    await user.click(screen.getByTitle(/2026-07:/));
    expect(onMonthSelect).toHaveBeenCalledWith("2026-07");
  });

  it("highlights the button for the selected month", () => {
    render(
      <DividendIncomeBars
        data={breakdown}
        year={2026}
        currentMonth="2026-07"
        selectedMonth="2026-07"
      />,
    );
    const julyButton = screen.getByTitle(/2026-07:/);
    expect(julyButton.className).toContain("bg-surface-active");
  });

  it("does not highlight any button when selectedMonth is not provided", () => {
    const { container } = render(
      <DividendIncomeBars data={breakdown} year={2026} currentMonth="2026-07" />,
    );
    const buttons = container.querySelectorAll("button");
    buttons.forEach((b) => expect(b.className).not.toContain("bg-surface-active"));
  });

  it("shows the twelve months of the given year, January first", () => {
    render(
      <DividendIncomeBars
        data={[
          {
            month: "2026-01",
            retroactive: "5.26",
            announced: "0",
            projected: "0",
            currency: "USD",
          },
          {
            month: "2026-12",
            retroactive: "0",
            announced: "0",
            projected: "8.15",
            currency: "USD",
          },
        ]}
        year={2026}
        currentMonth="2026-08"
      />,
    );
    const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(labels).toHaveLength(12);
    expect(labels[0]).toContain("Jan");
    expect(labels[11]).toContain("Dec");
    // No year on the January tick. It was there to mark a boundary the deleted
    // rolling window could cross; in a chart of one picked year it implies a
    // crossing that cannot happen.
    expect(labels[0]).not.toContain("'26");
  });

  it("pads a month the payload does not mention rather than dropping it", () => {
    // An absent month must still occupy its slot: that empty column is where the
    // projection horizon running out becomes visible.
    render(
      <DividendIncomeBars
        data={[
          {
            month: "2026-03",
            retroactive: "9.95",
            announced: "0",
            projected: "0",
            currency: "USD",
          },
        ]}
        year={2026}
        currentMonth="2026-08"
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(12);
  });

  it("ignores months outside the given year", () => {
    render(
      <DividendIncomeBars
        data={[
          {
            month: "2025-11",
            retroactive: "99.00",
            announced: "0",
            projected: "0",
            currency: "USD",
          },
          {
            month: "2026-05",
            retroactive: "9.47",
            announced: "0",
            projected: "0",
            currency: "USD",
          },
        ]}
        year={2026}
        currentMonth="2026-08"
      />,
    );
    // 99 belongs to 2025 and must not appear in a 2026 chart.
    expect(screen.queryByText("99")).not.toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("names the number of distinct payers in a month's tooltip", () => {
    // The year grid this replaces showed "2 payers" at rest; losing it entirely
    // would drop the only signal for which months are thin.
    render(
      <DividendIncomeBars
        data={[
          {
            month: "2026-05",
            retroactive: "9.47",
            announced: "0",
            projected: "0",
            currency: "USD",
          },
        ]}
        year={2026}
        currentMonth="2026-08"
        payersByMonth={new Map([["2026-05", 2]])}
      />,
    );
    const may = screen.getAllByRole("button")[4]!;
    expect(may.getAttribute("title")).toContain("2 payers");
  });

  it("draws the average line when every month agrees on a currency", () => {
    render(<DividendIncomeBars data={breakdown} year={2026} currentMonth="2026-07" />);
    expect(screen.getByText("avg")).toBeInTheDocument();
  });

  // FX-incomplete: the API leaves some months in their native currency while
  // the rest convert to the display currency. The average line sums all
  // twelve months together, so drawing it at a position derived from adding
  // DKK to USD would be a lie with no label to explain it — the fix is to not
  // draw the line at all rather than draw it in the wrong place.
  it("hides the average line rather than drawing it from a mixed-currency sum", () => {
    render(
      <DividendIncomeBars
        data={[
          {
            month: "2026-06",
            retroactive: "47.00",
            announced: "0",
            projected: "0",
            currency: "USD",
          },
          {
            month: "2026-07",
            retroactive: "30.00",
            announced: "0",
            projected: "0",
            currency: "DKK",
          },
        ]}
        year={2026}
        currentMonth="2026-07"
      />,
    );
    expect(screen.queryByText("avg")).not.toBeInTheDocument();
    // Each bar's own figure is untouched — only the rolled-up average line
    // is withheld.
    expect(screen.getByText("47")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  // The status filter sits between this chart and the month detail, and names
  // its three options exactly as this chart's three series. One control that
  // appears to govern both while moving only the detail is what this closes.
  it("zeroes a deselected series before measuring heights, labels or the average", () => {
    const { rerender } = render(
      <DividendIncomeBars data={breakdown} year={2026} currentMonth="2026-07" />,
    );
    // December is the only month made entirely of estimated income.
    expect(screen.getByText("64")).toBeInTheDocument();
    const avgBefore = screen.getByText("avg").parentElement!.getAttribute("style");

    rerender(
      <DividendIncomeBars
        data={breakdown}
        year={2026}
        currentMonth="2026-07"
        activeStatuses={new Set(["paid", "announced"])}
      />,
    );

    // The bar falls to zero: no value label, and nothing left in its tooltip.
    expect(screen.queryByText("64")).not.toBeInTheDocument();
    expect(screen.getByTitle(/2026-12:/).getAttribute("title")).toContain("estimated 0.00");
    // A month with no estimated income is untouched.
    expect(screen.getByText("47")).toBeInTheDocument();
    // The average is a sum over all twelve months, so it has to move too.
    expect(screen.getByText("avg").parentElement!.getAttribute("style")).not.toBe(avgBefore);
  });

  it("keeps all three series in the legend when one is deselected", () => {
    // Only the data responds to the filter; the vocabulary the chart is drawn
    // in stays complete, or the reader loses the key to the colours.
    render(
      <DividendIncomeBars
        data={breakdown}
        year={2026}
        currentMonth="2026-07"
        activeStatuses={new Set(["paid"])}
      />,
    );
    expect(screen.getByText("Estimated")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("says '1 payer', not '1 payers'", () => {
    render(
      <DividendIncomeBars
        data={[
          {
            month: "2026-04",
            retroactive: "5.42",
            announced: "0",
            projected: "0",
            currency: "USD",
          },
        ]}
        year={2026}
        currentMonth="2026-08"
        payersByMonth={new Map([["2026-04", 1]])}
      />,
    );
    expect(screen.getAllByRole("button")[3]!.getAttribute("title")).toContain("1 payer");
  });
});
