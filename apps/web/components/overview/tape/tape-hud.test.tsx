import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TapeHud, formatDates } from "./tape-hud";
import { RangeControl } from "./range-control";
import { resolveRange } from "../../../lib/income-tape/ranges";
import { isoToDay } from "../../../lib/income-tape/points";
import { allByMoney } from "../../../lib/test/by-money";

const today = isoToDay("2026-09-28");
const ctx = {
  todayDay: today,
  year: 2026,
  extent: { firstDay: today - 900, lastDay: today + 900 },
};
const totals = { total: 6400.5, paid: 0, confirmed: 400, estimated: 6000.5, count: 53 };

describe("TapeHud", () => {
  it("names the range and its dates, the figure, the split and the comparison", () => {
    render(
      <TapeHud
        range={resolveRange("today", ctx)}
        totals={totals}
        prev={{ ...totals, total: 6184 }}
        currency="DKK"
        focus={null}
        motion={false}
      />,
    );
    expect(screen.getByText("Next 12 months")).toBeInTheDocument();
    expect(screen.getByText(formatDates([today, today + 365]))).toBeInTheDocument();
    expect(allByMoney("DKK 6,400.50")).toHaveLength(1);
    expect(screen.getByText(/confirmed 400/)).toBeInTheDocument();
    expect(screen.getByText("vs last 12 months")).toBeInTheDocument();
    expect(screen.getByText("+3.5%")).toBeInTheDocument();
  });

  it("rolls toward a new figure rather than painting the final value first", () => {
    const hud = (total: number) => (
      <TapeHud
        range={resolveRange("today", ctx)}
        totals={{ ...totals, total }}
        prev={{ ...totals, total: 6184 }}
        currency="DKK"
        focus={null}
        motion
      />
    );
    const { rerender, container } = render(hud(6400.5));
    const figure = () => container.querySelector(".horizon-num > span:last-child")!.textContent;
    expect(figure()).toBe("6,400.50");
    rerender(hud(9000));
    // Before the first animation frame the figure still reads its old value:
    // React committing "9,000.00" and the roll snapping back would flash it.
    expect(figure()).not.toBe("9,000.00");
    expect(figure()).toBe("6,400.50");
  });

  it("prefixes the focused payer and hides the comparison for All time", () => {
    render(
      <TapeHud
        range={resolveRange("all", ctx)}
        totals={totals}
        prev={null}
        currency="DKK"
        focus="KO"
        motion={false}
      />,
    );
    expect(screen.getByText("KO · All time")).toBeInTheDocument();
    expect(screen.queryByText(/^vs /)).not.toBeInTheDocument();
  });

  it("overlays the focus card on the comparison slot instead of growing the HUD", () => {
    render(
      <TapeHud
        range={resolveRange("today", ctx)}
        totals={totals}
        prev={{ ...totals, total: 6184 }}
        currency="DKK"
        focus="KO"
        motion={false}
        aside={<div data-testid="focus-card">card</div>}
      />,
    );
    // The comparison it replaces stays mounted, just hidden — removing it
    // would let the slot collapse and the HUD grow when the card is taller.
    const comparison = screen.getByText("vs last 12 months").closest("div")!;
    expect(comparison).toHaveClass("invisible");
    expect(comparison).toBeInTheDocument();

    // The card itself sits absolutely inside the slot, anchored bottom-right,
    // so it overlays rather than participates in the slot's own height.
    const card = screen.getByTestId("focus-card").parentElement!;
    expect(card).toHaveClass("absolute");
    expect(card).toHaveClass("bottom-0");
    expect(card).toHaveClass("right-0");

    // The slot is a fixed-width, non-shrinking column, not a wrap target —
    // a `flex-wrap` row can still break onto two lines when this column's
    // un-shrunk width doesn't fit, which is what let the card land on top
    // of the figure above it. The row only switches to two columns at `lg`
    // (1024): `sm` still let `main` scroll horizontally between 640–768.
    const slot = comparison.parentElement!;
    expect(slot).toHaveClass("shrink-0");
    expect(slot.className).toContain("lg:w-[310px]");
    expect(slot.className).toContain("max-lg:min-h-60");

    const row = slot.parentElement!;
    expect(row.className).not.toContain("flex-wrap");
    expect(row.className).toContain("lg:flex-row");
    expect(row.className).toContain("lg:flex-nowrap");
  });

  it("keeps the eyebrow on one line, truncating the dates instead of wrapping", () => {
    render(
      <TapeHud
        range={resolveRange("today", ctx)}
        totals={totals}
        prev={{ ...totals, total: 6184 }}
        currency="DKK"
        focus="CASH_SAVINGS"
        motion={false}
      />,
    );
    // Focusing prefixes the eyebrow with the ticker; that extra text used to
    // push it onto a second line below `lg`, shifting the tape 15px.
    const label = screen.getByText("CASH_SAVINGS · Next 12 months");
    const eyebrow = label.parentElement!;
    expect(eyebrow.className).not.toContain("flex-wrap");
    expect(eyebrow.className).toContain("min-w-0");
    expect(label.className).toContain("whitespace-nowrap");
    expect(label.className).toContain("shrink-0");

    const dates = screen.getByText(formatDates([today, today + 365]));
    expect(dates.className).toContain("truncate");
    expect(dates.className).toContain("min-w-0");
  });
});

describe("RangeControl", () => {
  it("offers the four ranges and steps the year within bounds", () => {
    const onPick = vi.fn();
    const onStepYear = vi.fn();
    render(
      <RangeControl
        active="today"
        year={2029}
        bounds={{ min: 2019, max: 2029 }}
        onPick={onPick}
        onStepYear={onStepYear}
      />,
    );
    for (const name of ["Today", "2029", "Year to date", "All time"]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Next year" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    expect(onStepYear).toHaveBeenCalledWith(-1);
    fireEvent.click(screen.getByRole("radio", { name: "All time" }));
    expect(onPick).toHaveBeenCalledWith("all");
  });
});
