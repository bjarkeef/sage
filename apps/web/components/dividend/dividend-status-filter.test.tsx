import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DividendStatusFilter } from "./dividend-status-filter";
import type { CalendarStatus } from "../dividend-calendar-grid";

describe("DividendStatusFilter", () => {
  it("marks active statuses pressed and inactive ones not", () => {
    const active = new Set<CalendarStatus>(["paid", "announced"]);
    render(<DividendStatusFilter active={active} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Paid" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Estimated" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("emits the toggled status value (not the label)", () => {
    const onToggle = vi.fn();
    const active = new Set<CalendarStatus>(["paid", "announced", "projected"]);
    render(<DividendStatusFilter active={active} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Estimated" }));
    expect(onToggle).toHaveBeenCalledWith("projected");
  });
});
