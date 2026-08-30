import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IncomeComposition } from "./income-composition";
const groups = {
  holdings: [
    { label: "Cash account", amount: { amount: "826", currency: "DKK" }, share: 0.251 },
    { label: "FRANKA", amount: { amount: "362", currency: "DKK" }, share: 0.11 },
  ],
  sector: [
    { label: "Financials", amount: { amount: "1100", currency: "DKK" }, share: 0.34 },
    { label: "Real estate", amount: { amount: "720", currency: "DKK" }, share: 0.22 },
  ],
  currency: [{ label: "EUR", amount: { amount: "1100", currency: "DKK" }, share: 0.34 }],
};
describe("IncomeComposition", () => {
  it("shows holdings legend by default", () => {
    render(<IncomeComposition groups={groups} />);
    expect(screen.getByText("Cash account")).toBeInTheDocument();
  });
  it("switches to sector grouping when toggled", () => {
    render(<IncomeComposition groups={groups} />);
    // SegmentedControl renders each option as role="radio" (see segmented-control.tsx), not role="button"
    fireEvent.click(screen.getByRole("radio", { name: /sector/i }));
    expect(screen.getByText("Financials")).toBeInTheDocument();
    expect(screen.queryByText("Cash account")).not.toBeInTheDocument();
  });

  it("toggles back to holdings after switching away", () => {
    render(<IncomeComposition groups={groups} />);
    fireEvent.click(screen.getByRole("radio", { name: /sector/i }));
    fireEvent.click(screen.getByRole("radio", { name: /holdings/i }));
    expect(screen.getByText("Cash account")).toBeInTheDocument();
    expect(screen.queryByText("Financials")).not.toBeInTheDocument();
  });

  it("rolls a long tail past 7 rows into a single 'N others' row", () => {
    // 10 rows -> 7 named + a "3 others" roll-up (rows 8,9,10).
    const many = Array.from({ length: 10 }, (_, i) => ({
      label: `Holding ${i + 1}`,
      amount: { amount: "100", currency: "DKK" },
      share: 0.1,
    }));
    render(<IncomeComposition groups={{ ...groups, holdings: many }} />);
    expect(screen.getByText("Holding 7")).toBeInTheDocument();
    expect(screen.queryByText("Holding 8")).not.toBeInTheDocument();
    expect(screen.getByText("3 others")).toBeInTheDocument();
  });

  it("renders without crashing when a group is empty", () => {
    render(<IncomeComposition groups={{ holdings: [], sector: [], currency: [] }} />);
    // No legend rows, no throw.
    expect(screen.getByRole("radio", { name: /holdings/i })).toBeInTheDocument();
  });
});
