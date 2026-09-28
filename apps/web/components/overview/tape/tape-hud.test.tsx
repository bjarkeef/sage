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
