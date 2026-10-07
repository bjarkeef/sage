import { describe, it, expect } from "vitest";
import { goalMark } from "./goal-line";
import type { GoalViewDTO } from "../types";

function goal(
  type: "passive_income" | "value",
  amount: string,
  currency = "DKK",
  withResult = true,
): GoalViewDTO {
  return {
    goal: { type, amount, currency, targetYear: 2040 } as GoalViewDTO["goal"],
    defaults: null,
    result: withResult
      ? ({
          currency,
          progressPct: 2,
          currentMetric: "5000",
          goalAtTargetYear: amount,
          targetYear: 2040,
        } as GoalViewDTO["result"])
      : null,
  };
}

const base = {
  displayCurrency: "DKK",
  focused: false,
  years: [
    { year: 2025, total: 5000 },
    { year: 2026, total: 6000 },
    { year: 2027, total: 7000 },
  ],
  currentYearTotal: 6000,
};

describe("goalMark", () => {
  it("draws nothing without a goal, for a net-worth goal, without a projection, across currencies or while focused", () => {
    expect(goalMark({ ...base, goal: null })).toEqual({ kind: "none" });
    expect(goalMark({ ...base, goal: goal("value", "9000") })).toEqual({ kind: "none" });
    expect(goalMark({ ...base, goal: goal("passive_income", "9000", "DKK", false) })).toEqual({
      kind: "none",
    });
    expect(goalMark({ ...base, goal: goal("passive_income", "9000", "EUR") })).toEqual({
      kind: "none",
    });
    expect(goalMark({ ...base, focused: true, goal: goal("passive_income", "9000") })).toEqual({
      kind: "none",
    });
  });

  it("draws a line when the goal fits the ribbon, naming the first year that reaches it", () => {
    expect(goalMark({ ...base, goal: goal("passive_income", "6500") })).toEqual({
      kind: "line",
      amount: 6500,
      label: "GOAL DKK 6,500 · first reached in 2027",
    });
    expect(goalMark({ ...base, goal: goal("passive_income", "9000") })).toEqual({
      kind: "line",
      amount: 9000,
      label: "GOAL DKK 9,000",
    });
  });

  it("captions a goal too large for the ribbon instead of squashing the bars", () => {
    expect(goalMark({ ...base, goal: goal("passive_income", "200000") })).toEqual({
      kind: "caption",
      text: "Goal: DKK 200,000 a year by 2040 — 3.0% of it this year",
    });
  });
});
