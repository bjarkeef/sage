import Decimal from "decimal.js";

export interface GoalProjectionParams {
  mode: "income" | "value";
  /** Current portfolio market value (computation currency). */
  startValue: Decimal;
  /** Goal in today's terms; NET annual income when incomeTaxPct is set (income mode). */
  goalAmount: Decimal;
  /** Whole years from today to the target year. */
  targetYears: number;
  monthlyContribution: Decimal;
  /** Annual step-up of contributions, percent (0 = none). */
  contributionGrowthPct: Decimal;
  /** Gross forward dividend yield, percent (income mode). */
  divYieldPct: Decimal;
  /** Annual dividend growth, percent (income mode). */
  divGrowthPct: Decimal;
  /** Total annual return, percent (value mode; includes dividends). */
  annualReturnPct: Decimal;
  inflationPct: Decimal;
  adjustGoalForInflation: boolean;
  reinvestDividends: boolean;
  /** Income mode only: net semantics — income rows, reinvested cash, and
   *  goal achievement are all after tax. Null = gross. */
  incomeTaxPct: Decimal | null;
  /** Simulation horizon in years. Default 50. */
  maxYears?: number;
}

export interface GoalYearRow {
  /** 0 = today; rows are anchored to today's date, not calendar years. */
  yearOffset: number;
  /** That year's goal (inflation-adjusted when enabled). */
  goal: Decimal;
  annualContribution: Decimal;
  monthlyContribution: Decimal;
  value: Decimal;
  /** Annual income at that point; NET when incomeTaxPct is set. */
  income: Decimal;
  /** metric ≥ goal for that row (income in income mode, value in value mode). */
  achieved: boolean;
}

export interface GoalSimulation {
  rows: GoalYearRow[];
  /** Smallest yearOffset whose row achieved the goal; null if never. */
  achievedInYears: number | null;
}

const ONE = new Decimal(1);

/**
 * Monthly-step simulation reported as annual rows (Snowball's model, validated
 * against its results table — see the spec's "Snowball reference semantics"):
 *
 * Income mode is deliberately conservative: portfolio value grows ONLY via
 * contributions and (optionally) reinvested dividends — no price appreciation.
 * Income = value × yield, with the effective yield compounding at the
 * dividend-growth rate. Value mode compounds value at the total annual return
 * (minus the yield when dividends are not reinvested, since that cash leaves).
 */
export function simulateGoal(params: GoalProjectionParams): GoalSimulation {
  const maxYears = params.maxYears ?? 50;
  const taxFactor =
    params.mode === "income" && params.incomeTaxPct
      ? ONE.minus(params.incomeTaxPct.dividedBy(100))
      : ONE;
  const yieldRate = params.divYieldPct.dividedBy(100);
  const growthFactor = ONE.plus(params.divGrowthPct.dividedBy(100));
  const inflationFactor = ONE.plus(params.inflationPct.dividedBy(100));
  const contribFactor = ONE.plus(params.contributionGrowthPct.dividedBy(100));

  // Value mode: total return includes dividends; if they are not reinvested
  // that component leaves the portfolio as cash.
  const valueAnnualPct = params.reinvestDividends
    ? params.annualReturnPct
    : params.annualReturnPct.minus(params.divYieldPct);
  const valueMonthlyFactor = ONE.plus(valueAnnualPct.dividedBy(100)).pow(ONE.dividedBy(12));

  const goalAt = (t: number): Decimal =>
    params.adjustGoalForInflation
      ? params.goalAmount.times(inflationFactor.pow(t))
      : params.goalAmount;

  /** Annual income at value v, t years out (net when tax semantics apply). */
  const incomeAt = (v: Decimal, t: Decimal | number): Decimal =>
    v.times(yieldRate).times(growthFactor.pow(t)).times(taxFactor);

  const rows: GoalYearRow[] = [];
  let achievedInYears: number | null = null;
  let value = params.startValue;

  const pushRow = (t: number) => {
    const monthly = params.monthlyContribution.times(contribFactor.pow(t));
    const income = incomeAt(value, t);
    const goal = goalAt(t);
    const metric = params.mode === "income" ? income : value;
    const achieved = metric.greaterThanOrEqualTo(goal);
    if (achieved && achievedInYears === null) achievedInYears = t;
    rows.push({
      yearOffset: t,
      goal,
      annualContribution: monthly.times(12),
      monthlyContribution: monthly,
      value,
      income,
      achieved,
    });
  };

  pushRow(0);
  for (let year = 0; year < maxYears; year++) {
    // Contributions step up once per year (Snowball's table shows annual steps).
    const contribution = params.monthlyContribution.times(contribFactor.pow(year));
    for (let month = 0; month < 12; month++) {
      if (params.mode === "income") {
        const tYears = new Decimal(year).plus(new Decimal(month).dividedBy(12));
        const monthlyIncome = value.times(yieldRate).dividedBy(12).times(growthFactor.pow(tYears));
        const reinvested = params.reinvestDividends
          ? monthlyIncome.times(taxFactor) // tax is paid before cash can be reinvested
          : new Decimal(0);
        value = value.plus(contribution).plus(reinvested);
      } else {
        value = value.times(valueMonthlyFactor).plus(contribution);
      }
    }
    pushRow(year + 1);
  }

  return { rows, achievedInYears };
}

export interface ChangedParam {
  key: "contributionGrowthPct" | "divGrowthPct" | "monthlyContribution";
  from: Decimal;
  to: Decimal;
}

export interface AlternativeScenario {
  params: GoalProjectionParams;
  changed: ChangedParam[];
}

/** Solver caps and granularity — deterministic and explainable by design. */
const CONTRIB_GROWTH_CAP = new Decimal(25);
const CONTRIB_GROWTH_STEP = new Decimal("0.5");
const DIV_GROWTH_CAP = new Decimal(8);
const DIV_GROWTH_STEP = new Decimal("0.25");
const CONTRIB_MULTIPLIER_CAP = new Decimal(3);
const CONTRIB_MULTIPLIER_STEP = new Decimal("0.05");

function achievesBy(params: GoalProjectionParams, targetYears: number): boolean {
  // Only simulate to the target year — the solver runs hundreds of candidate
  // simulations, and anything past targetYears cannot change the answer.
  const { achievedInYears } = simulateGoal({ ...params, maxYears: targetYears });
  return achievedInYears !== null && achievedInYears <= targetYears;
}

/**
 * When the base scenario misses the target year, search — in a fixed,
 * explainable order — for the smallest single-parameter change that makes the
 * goal achievable in time:
 *   1. raise the annual contribution increase (up to 25%),
 *   2. raise dividend growth (income mode only, up to 8%),
 *   3. raise the monthly contribution (up to 3×),
 *   4. combine caps of 1 and 3.
 * Returns null when the base already achieves in time, or nothing works.
 */
export function solveAlternativeScenario(
  base: GoalProjectionParams,
  targetYears: number,
): AlternativeScenario | null {
  if (achievesBy(base, targetYears)) return null;

  // 1. Contribution growth (linear scan for the minimal working value).
  for (
    let pct = base.contributionGrowthPct.plus(CONTRIB_GROWTH_STEP);
    pct.lessThanOrEqualTo(CONTRIB_GROWTH_CAP);
    pct = pct.plus(CONTRIB_GROWTH_STEP)
  ) {
    const candidate = { ...base, contributionGrowthPct: pct };
    if (achievesBy(candidate, targetYears)) {
      return {
        params: candidate,
        changed: [{ key: "contributionGrowthPct", from: base.contributionGrowthPct, to: pct }],
      };
    }
  }

  // 2. Dividend growth (income mode only).
  if (base.mode === "income") {
    for (
      let pct = base.divGrowthPct.plus(DIV_GROWTH_STEP);
      pct.lessThanOrEqualTo(DIV_GROWTH_CAP);
      pct = pct.plus(DIV_GROWTH_STEP)
    ) {
      const candidate = { ...base, divGrowthPct: pct };
      if (achievesBy(candidate, targetYears)) {
        return {
          params: candidate,
          changed: [{ key: "divGrowthPct", from: base.divGrowthPct, to: pct }],
        };
      }
    }
  }

  // 3. Monthly contribution (multiplier scan).
  for (
    let mult = new Decimal(1).plus(CONTRIB_MULTIPLIER_STEP);
    mult.lessThanOrEqualTo(CONTRIB_MULTIPLIER_CAP);
    mult = mult.plus(CONTRIB_MULTIPLIER_STEP)
  ) {
    const contribution = base.monthlyContribution.times(mult);
    const candidate = { ...base, monthlyContribution: contribution };
    if (achievesBy(candidate, targetYears)) {
      return {
        params: candidate,
        changed: [{ key: "monthlyContribution", from: base.monthlyContribution, to: contribution }],
      };
    }
  }

  // 4. Contribution growth at cap + contribution multiplier.
  for (
    let mult = new Decimal(1).plus(CONTRIB_MULTIPLIER_STEP);
    mult.lessThanOrEqualTo(CONTRIB_MULTIPLIER_CAP);
    mult = mult.plus(CONTRIB_MULTIPLIER_STEP)
  ) {
    const contribution = base.monthlyContribution.times(mult);
    const candidate = {
      ...base,
      contributionGrowthPct: CONTRIB_GROWTH_CAP,
      monthlyContribution: contribution,
    };
    if (achievesBy(candidate, targetYears)) {
      return {
        params: candidate,
        changed: [
          {
            key: "contributionGrowthPct",
            from: base.contributionGrowthPct,
            to: CONTRIB_GROWTH_CAP,
          },
          { key: "monthlyContribution", from: base.monthlyContribution, to: contribution },
        ],
      };
    }
  }

  return null;
}
