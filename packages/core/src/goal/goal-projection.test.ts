import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  simulateGoal,
  solveAlternativeScenario,
  type GoalProjectionParams,
} from "./goal-projection";

/** Base fixture ≈ the Snowball reference account: 131 665 value, 2.92% yield,
 *  4.25% dividend growth, 10 000/mo contributions growing 2.5%/yr, goal
 *  120 000/yr income in 13 years, 2.5% inflation, reinvesting. */
function incomeParams(overrides: Partial<GoalProjectionParams> = {}): GoalProjectionParams {
  return {
    mode: "income",
    startValue: new Decimal("131665"),
    goalAmount: new Decimal("120000"),
    targetYears: 13,
    monthlyContribution: new Decimal("10000"),
    contributionGrowthPct: new Decimal("2.5"),
    divYieldPct: new Decimal("2.92"),
    divGrowthPct: new Decimal("4.25"),
    annualReturnPct: new Decimal("0"),
    inflationPct: new Decimal("2.5"),
    adjustGoalForInflation: true,
    reinvestDividends: true,
    incomeTaxPct: null,
    ...overrides,
  };
}

describe("simulateGoal — income mode", () => {
  it("row 0 is today: income = value × yield, goal unadjusted, not achieved", () => {
    const { rows } = simulateGoal(incomeParams());
    const r0 = rows[0]!;
    expect(r0.yearOffset).toBe(0);
    // 131665 × 0.0292 = 3844.618
    expect(r0.income.toNumber()).toBeCloseTo(3844.62, 1);
    expect(r0.goal.toNumber()).toBe(120000);
    expect(r0.achieved).toBe(false);
  });

  it("inflates the goal and steps contributions annually", () => {
    const { rows } = simulateGoal(incomeParams());
    // Snowball reference: goal 2027 row = 120000 × 1.025 = 123000
    expect(rows[1]!.goal.toNumber()).toBeCloseTo(123000, 2);
    expect(rows[1]!.monthlyContribution.toNumber()).toBeCloseTo(10250, 2);
    expect(rows[1]!.annualContribution.toNumber()).toBeCloseTo(123000, 2);
    // goal at target year 13: 120000 × 1.025^13 ≈ 165421.33
    expect(rows[13]!.goal.toNumber()).toBeCloseTo(165421.33, 0);
  });

  it("keeps the goal flat when adjustGoalForInflation is off", () => {
    const { rows } = simulateGoal(incomeParams({ adjustGoalForInflation: false }));
    expect(rows[13]!.goal.toNumber()).toBe(120000);
  });

  it("projects year-1 income in the Snowball ballpark (contributions + reinvest + growth)", () => {
    const { rows } = simulateGoal(incomeParams());
    // Snowball's table shows 7 704 for year 1; our monthly model must land close.
    expect(rows[1]!.income.toNumber()).toBeGreaterThan(7000);
    expect(rows[1]!.income.toNumber()).toBeLessThan(8400);
  });

  it("achieves later without reinvestment than with it", () => {
    const withReinvest = simulateGoal(incomeParams());
    const withoutReinvest = simulateGoal(incomeParams({ reinvestDividends: false }));
    expect(withReinvest.achievedInYears).not.toBeNull();
    expect(withoutReinvest.achievedInYears).not.toBeNull();
    expect(withoutReinvest.achievedInYears!).toBeGreaterThan(withReinvest.achievedInYears!);
  });

  it("returns null achievedInYears when the goal is out of reach", () => {
    const { achievedInYears } = simulateGoal(
      incomeParams({
        monthlyContribution: new Decimal("0"),
        reinvestDividends: false,
        divGrowthPct: new Decimal("0"),
        goalAmount: new Decimal("1000000"),
      }),
    );
    expect(achievedInYears).toBeNull();
  });

  it("applies tax to income rows, reinvested cash, and achievement", () => {
    const gross = simulateGoal(incomeParams());
    const taxed = simulateGoal(incomeParams({ incomeTaxPct: new Decimal("27") }));
    // Row 0 net income = gross × 0.73
    expect(taxed.rows[0]!.income.toNumber()).toBeCloseTo(
      gross.rows[0]!.income.times("0.73").toNumber(),
      2,
    );
    // Net mode reaches the same (net-denominated) goal later than gross mode
    expect(taxed.achievedInYears!).toBeGreaterThan(gross.achievedInYears!);
  });

  it("simulates up to maxYears and no further", () => {
    const { rows } = simulateGoal(incomeParams({ maxYears: 5 }));
    expect(rows).toHaveLength(6); // offsets 0..5
    expect(rows[5]!.yearOffset).toBe(5);
  });
});

describe("simulateGoal — value mode", () => {
  it("compounds value at the annual return and achieves a value goal", () => {
    const { rows, achievedInYears } = simulateGoal(
      incomeParams({
        mode: "value",
        goalAmount: new Decimal("500000"),
        annualReturnPct: new Decimal("8"),
        adjustGoalForInflation: false,
        monthlyContribution: new Decimal("10000"),
        contributionGrowthPct: new Decimal("0"),
      }),
    );
    // Year 1: ~131665×1.08 + 120000 contributions (+intra-year growth) > 260000
    expect(rows[1]!.value.toNumber()).toBeGreaterThan(260000);
    expect(achievedInYears).not.toBeNull();
    expect(achievedInYears!).toBeLessThanOrEqual(4);
  });

  it("grows slower when dividends are not reinvested (return minus yield)", () => {
    const base = {
      mode: "value" as const,
      goalAmount: new Decimal("1000000"),
      annualReturnPct: new Decimal("8"),
      divYieldPct: new Decimal("3"),
      adjustGoalForInflation: false,
    };
    const withReinvest = simulateGoal(incomeParams({ ...base, reinvestDividends: true }));
    const withoutReinvest = simulateGoal(incomeParams({ ...base, reinvestDividends: false }));
    expect(withoutReinvest.rows[10]!.value.toNumber()).toBeLessThan(
      withReinvest.rows[10]!.value.toNumber(),
    );
  });
});

describe("solveAlternativeScenario", () => {
  it("returns null when the base scenario already achieves by the target year", () => {
    // Tiny goal: achieved immediately.
    const p = incomeParams({ goalAmount: new Decimal("3000") });
    expect(solveAlternativeScenario(p, 13)).toBeNull();
  });

  it("finds a minimal contribution-growth bump first and reports the change", () => {
    // Base misses 13y (Snowball reference: achievable in 21y).
    const p = incomeParams();
    const alt = solveAlternativeScenario(p, 13);
    expect(alt).not.toBeNull();
    expect(alt!.changed).toHaveLength(1);
    expect(alt!.changed[0]!.key).toBe("contributionGrowthPct");
    expect(alt!.changed[0]!.from.toNumber()).toBe(2.5);
    expect(alt!.changed[0]!.to.toNumber()).toBeLessThanOrEqual(25);
    // The returned params must actually achieve by the target year.
    const sim = simulateGoal(alt!.params);
    expect(sim.achievedInYears).not.toBeNull();
    expect(sim.achievedInYears!).toBeLessThanOrEqual(13);
    // Determinism: same input, same output.
    const again = solveAlternativeScenario(p, 13);
    expect(again!.changed[0]!.to.toNumber()).toBe(alt!.changed[0]!.to.toNumber());
  });

  it("falls through the knob order and returns null when hopeless", () => {
    const hopeless = incomeParams({
      goalAmount: new Decimal("100000000"),
      monthlyContribution: new Decimal("100"),
      targetYears: 2,
    });
    expect(solveAlternativeScenario(hopeless, 2)).toBeNull();
  });
});
