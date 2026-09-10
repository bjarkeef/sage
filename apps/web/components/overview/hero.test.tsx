import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewHero } from "./hero";

const value = { amount: "343029.27", currency: "USD" };
const todayChange = { amount: { amount: "150", currency: "USD" }, percent: 1.5 };

describe("OverviewHero", () => {
  it("shows today's change when nothing is under the pointer", () => {
    render(<OverviewHero value={value} todayChange={todayChange} />);
    expect(screen.getByText("$343,029.27")).toBeInTheDocument();
    expect(screen.getByText("today")).toBeInTheDocument();
  });

  it("shows the scrubbed day's value instead of the latest one", () => {
    render(
      <OverviewHero
        value={value}
        todayChange={todayChange}
        scrubbed={{
          date: "2026-03-14",
          value: { amount: "298400.10", currency: "USD" },
          invested: { amount: "270000", currency: "USD" },
        }}
      />,
    );
    expect(screen.getByText("$298,400.10")).toBeInTheDocument();
    expect(screen.queryByText("$343,029.27")).not.toBeInTheDocument();
  });

  it("drops 'today' while scrubbing, because the pointer is not on today", () => {
    // The delta is a claim about now. Leaving it beside a March figure would
    // pair a March value with today's movement and read as one fact.
    render(
      <OverviewHero
        value={value}
        todayChange={todayChange}
        scrubbed={{
          date: "2026-03-14",
          value: { amount: "298400.10", currency: "USD" },
          invested: { amount: "270000", currency: "USD" },
        }}
      />,
    );
    expect(screen.queryByText("today")).not.toBeInTheDocument();
    expect(screen.getByText("Mar 14, 2026")).toBeInTheDocument();
  });

  it("falls back to a dash when there is no value at all", () => {
    render(<OverviewHero value={null} todayChange={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
