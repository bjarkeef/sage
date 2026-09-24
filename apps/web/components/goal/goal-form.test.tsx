import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GoalForm } from "./goal-form";
import type { GoalDefaultsDTO, PutGoalInput } from "../../lib/types";

const defaults: GoalDefaultsDTO = {
  currency: "DKK",
  divYieldPct: "2.92",
  divGrowthPct: "4.25",
  annualReturnPct: "12.84",
  monthlyContribution: "277.39",
  inflationPct: "2.5",
  dividendTaxRate: null,
};

describe("GoalForm", () => {
  it("renders passive-income mode with computed-default hints", () => {
    render(
      <GoalForm
        goal={null}
        defaults={defaults}
        saving={false}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /save and calculate/i })).toBeInTheDocument();
    // The mode SegmentedControl is a role="radiogroup" div, which <label for>
    // cannot bind to; it must be named via aria-labelledby instead.
    expect(screen.getByRole("radiogroup", { name: "Goal" })).toBeInTheDocument();
    // yield/growth hints show the calculated values
    fireEvent.click(screen.getByRole("button", { name: /returns & inflation/i }));
    expect(screen.getByText(/2\.92/)).toBeInTheDocument();
    expect(screen.getByText(/4\.25/)).toBeInTheDocument();
  });

  it("switching to Value mode swaps yield/growth for a returns input", () => {
    render(
      <GoalForm
        goal={null}
        defaults={defaults}
        saving={false}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );
    // SegmentedControl renders each option as role="radio" (see segmented-control.tsx), not role="button"
    fireEvent.click(screen.getByRole("radio", { name: /^value$/i }));
    fireEvent.click(screen.getByRole("button", { name: /returns & inflation/i }));
    expect(screen.getByText(/12\.84/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/dividend growth/i)).not.toBeInTheDocument();
  });

  it("submits a numeric PutGoalInput on save", () => {
    const onSave = vi.fn<(input: PutGoalInput) => void>();
    render(
      <GoalForm
        goal={null}
        defaults={defaults}
        saving={false}
        onSave={onSave}
        onDelete={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/goal amount/i), { target: { value: "120000" } });
    fireEvent.click(screen.getByRole("button", { name: /save and calculate/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const input = onSave.mock.calls[0]![0];
    expect(input.type).toBe("passive_income");
    expect(input.amount).toBe(120000);
    expect(input.divYieldPct).toBeNull(); // untouched → server uses default
  });

  it("reads a decimal comma in the amount and rates", () => {
    const onSave = vi.fn<(input: PutGoalInput) => void>();
    render(
      <GoalForm
        goal={null}
        defaults={defaults}
        saving={false}
        onSave={onSave}
        onDelete={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/goal amount/i), { target: { value: "1500,50" } });
    fireEvent.click(screen.getByRole("button", { name: /returns & inflation/i }));
    fireEvent.change(screen.getByLabelText(/inflation/i), { target: { value: "2,5" } });
    fireEvent.click(screen.getByRole("button", { name: /save and calculate/i }));
    const input = onSave.mock.calls[0]![0];
    expect(input.amount).toBe(1500.5);
    expect(input.inflationPct).toBe(2.5);
  });

  it("does not submit when amount is empty", () => {
    const onSave = vi.fn();
    render(
      <GoalForm
        goal={null}
        defaults={defaults}
        saving={false}
        onSave={onSave}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save and calculate/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("marks the income goal amount as after-tax when a dividend tax rate is set", () => {
    const taxed: GoalDefaultsDTO = { ...defaults, dividendTaxRate: 27 };
    render(
      <GoalForm
        goal={null}
        defaults={taxed}
        saving={false}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText(/after tax \(27% dividend tax applied\)/i)).toBeInTheDocument();
    // typing an amount keeps the after-tax marker in the echo line
    fireEvent.change(screen.getByLabelText(/goal amount/i), { target: { value: "120000" } });
    expect(screen.getByText(/monthly after tax/i)).toBeInTheDocument();
    // value mode has no tax semantics — the marker disappears
    fireEvent.click(screen.getByRole("radio", { name: /^value$/i }));
    expect(screen.queryByText(/after tax/i)).not.toBeInTheDocument();
  });

  it("does not mention tax in the amount hint without a tax rate", () => {
    render(
      <GoalForm
        goal={null}
        defaults={defaults}
        saving={false}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.queryByText(/after tax/i)).not.toBeInTheDocument();
  });

  it("hides the 12-month-average chip when the computed default is zero", () => {
    const zeroDefaults: GoalDefaultsDTO = { ...defaults, monthlyContribution: "0.00" };
    render(
      <GoalForm
        goal={null}
        defaults={zeroDefaults}
        saving={false}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("Per month.")).toBeInTheDocument();
    expect(screen.queryByText(/12-month average/i)).not.toBeInTheDocument();
  });

  it("prefills from an existing goal and offers Remove", () => {
    const onDelete = vi.fn();
    render(
      <GoalForm
        goal={{
          type: "passive_income",
          amount: "120000.00",
          currency: "DKK",
          targetYear: new Date().getFullYear() + 13,
          monthlyContribution: "10000.00",
          contributionIncrease: "inflation",
          contributionIncreasePct: null,
          divYieldPct: null,
          divGrowthPct: null,
          annualReturnPct: null,
          adjustGoalForInflation: true,
          inflationPct: "2.50",
          reinvestDividends: true,
          suggestAlternative: true,
        }}
        defaults={defaults}
        saving={false}
        onSave={() => {}}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByLabelText(/goal amount/i)).toHaveValue("120000.00");
    fireEvent.click(screen.getByRole("button", { name: /remove goal/i }));
    expect(onDelete).toHaveBeenCalled();
  });
});
