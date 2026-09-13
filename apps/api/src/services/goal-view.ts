import { eq, and, gte } from "drizzle-orm";
import {
  Decimal,
  simulateGoal,
  solveAlternativeScenario,
  clampDividendGrowth,
  type GoalProjectionParams,
  type GoalYearRow,
} from "@sage/core";
import { goal, transaction } from "../db/schema";
import { getUserPortfolio } from "../auth";
import { buildDividendIncomeView, type DividendIncomeViewDeps } from "./dividend-income-view";
import { buildPortfolioView } from "./portfolio-view";
import { buildPerformanceView } from "./performance-view";

export interface GoalDTO {
  type: "passive_income" | "value";
  amount: string;
  currency: string;
  targetYear: number;
  monthlyContribution: string | null;
  contributionIncrease: "none" | "inflation" | "custom";
  contributionIncreasePct: string | null;
  divYieldPct: string | null;
  divGrowthPct: string | null;
  annualReturnPct: string | null;
  adjustGoalForInflation: boolean;
  inflationPct: string;
  reinvestDividends: boolean;
  suggestAlternative: boolean;
}

export interface GoalDefaultsDTO {
  currency: string;
  divYieldPct: string | null;
  divGrowthPct: string | null;
  annualReturnPct: string | null;
  monthlyContribution: string;
  inflationPct: string;
  /** User's dividend tax rate (percent). When set, an income goal amount is
   *  interpreted as NET (after-tax) income — the form surfaces this. */
  dividendTaxRate: number | null;
}

export interface GoalYearRowDTO {
  yearOffset: number;
  year: number;
  goal: string;
  annualContribution: string;
  monthlyContribution: string;
  value: string;
  income: string;
  achieved: boolean;
}

export interface GoalScenarioDTO {
  id: "portfolio" | "alternative";
  params: {
    divYieldPct: string;
    divGrowthPct: string;
    annualReturnPct: string;
    monthlyContribution: string;
    contributionGrowthPct: string;
    reinvestDividends: boolean;
  };
  changed?: { key: string; from: string; to: string }[];
  achievedInYears: number | null;
  achievedYear: number | null;
  rows: GoalYearRowDTO[];
}

export interface GoalResultDTO {
  netMode: boolean;
  currency: string;
  progressPct: number;
  currentMetric: string;
  goalAtTargetYear: string;
  targetYear: number;
  achievedInYears: number | null;
  achievedYear: number | null;
  scenarios: GoalScenarioDTO[];
}

export interface GoalViewDTO {
  goal: GoalDTO | null;
  defaults: GoalDefaultsDTO | null;
  result: GoalResultDTO | null;
  /** Prose for a human. Not a stable contract — read `reasonCode` to branch. */
  reason?: string;
  /**
   * Why there is no projection, as something the UI can switch on.
   *
   * `reason` was being rendered verbatim, so a new user met the goal page with
   * a lowercase sentence fragment and an "Open Settings" button — advice for
   * the multi-currency case, offered to someone whose actual problem was an
   * empty portfolio.
   */
  reasonCode?: "no_positions" | "multi_currency" | "goal_currency_stale";
}

const DEFAULT_INFLATION_PCT = "2.5";
const MAX_SIM_YEARS = 50;

function goalRowToDTO(row: typeof goal.$inferSelect): GoalDTO {
  return {
    type: row.type as GoalDTO["type"],
    amount: row.amount,
    currency: row.currency,
    targetYear: row.targetYear,
    monthlyContribution: row.monthlyContribution,
    contributionIncrease: row.contributionIncrease as GoalDTO["contributionIncrease"],
    contributionIncreasePct: row.contributionIncreasePct,
    divYieldPct: row.divYieldPct,
    divGrowthPct: row.divGrowthPct,
    annualReturnPct: row.annualReturnPct,
    adjustGoalForInflation: row.adjustGoalForInflation,
    inflationPct: row.inflationPct,
    reinvestDividends: row.reinvestDividends,
    suggestAlternative: row.suggestAlternative,
  };
}

export async function buildGoalView(
  deps: DividendIncomeViewDeps,
  userId: string,
): Promise<GoalViewDTO> {
  const { db } = deps;
  const { id: portfolioId } = await getUserPortfolio(db, userId);

  const [goalRow] = await db.select().from(goal).where(eq(goal.portfolioId, portfolioId));
  const goalDTO = goalRow ? goalRowToDTO(goalRow) : null;

  const [incomeView, portfolioView] = await Promise.all([
    buildDividendIncomeView(deps, userId, { currency: null }),
    buildPortfolioView(deps, userId, { currency: null }),
  ]);

  // An empty portfolio has nothing to project from or default against.
  const subtotals = portfolioView.body.subtotalsByCurrency;
  if (portfolioView.body.positions.length === 0) {
    return {
      goal: goalDTO,
      defaults: null,
      result: null,
      reason: "no positions yet — add transactions or import a portfolio first",
      reasonCode: "no_positions",
    };
  }

  // Computation currency: the display currency when set, else the single
  // native currency. Multi-currency without a display currency → no math.
  const currency =
    portfolioView.targetCurrency ?? (subtotals.length === 1 ? subtotals[0]!.currency : null);
  if (!currency) {
    return {
      goal: goalDTO,
      defaults: null,
      result: null,
      reason: "multi-currency portfolio — set a display currency in Settings",
      reasonCode: "multi_currency",
    };
  }

  // ---- Defaults ----
  const marketValue = new Decimal(
    subtotals.find((s) => s.currency === currency)?.marketValue.amount ?? "0",
  );
  const forwardIncome = new Decimal(
    incomeView.summary.projectedTwelveMonthIncome[0]?.amount ?? "0",
  );
  const divYieldPct = marketValue.greaterThan(0)
    ? forwardIncome.dividedBy(marketValue).times(100)
    : null;

  // Forward-income-weighted average of per-holding 5y dividend CAGR
  // (cagr5y is a FRACTION string, e.g. "0.0425" — convert to percent). Each
  // holding's CAGR is floored at 0% first when the user has turned off
  // negative growth (clampDividendGrowth), so a declining holding can't pull
  // the aggregate below zero. Per-holding CAGR/trend elsewhere is never
  // clamped — only this portfolio-wide default.
  let growthWeighted = new Decimal(0);
  let growthWeights = new Decimal(0);
  for (const h of incomeView.perHolding) {
    if (h.cagr5y == null) continue;
    const weight = new Decimal(h.forwardAnnualIncome.amount);
    if (weight.lessThanOrEqualTo(0)) continue;
    const cagr = clampDividendGrowth(new Decimal(h.cagr5y), incomeView.allowNegativeDividendGrowth);
    growthWeighted = growthWeighted.plus(cagr.times(weight));
    growthWeights = growthWeights.plus(weight);
  }
  const divGrowthPct = growthWeights.greaterThan(0)
    ? growthWeighted.dividedBy(growthWeights).times(100)
    : null;

  // Value-mode default return: the book's own all-time annualized TWR
  // (fraction → percent). Skip benchmark series — goal only needs the scalar.
  //
  // This used to be the money-weighted return, which on a book that moves
  // money between holdings reads far too high — 36% a year on the reporting
  // book — and offering that as a default expected return would have projected
  // a retirement out of an artefact. The time-weighted rate is the compound
  // growth the holdings actually delivered, which is the thing being projected
  // forward. See `buildPerformanceView` for why no MWR is published at all.
  const perf = await buildPerformanceView(deps, userId, {
    range: "ALL",
    benchmarks: [],
  });
  const annualReturnPct =
    perf.twrAnnualized == null ? null : new Decimal(perf.twrAnnualized).times(100);

  // Average monthly buys over the trailing 12 months, in the computation
  // currency. Same-currency rows only (mirrors the yield-on-cost convention);
  // FX-converting historic buys is out of scope for a default.
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const buys = await db
    .select()
    .from(transaction)
    .where(
      and(
        eq(transaction.portfolioId, portfolioId),
        eq(transaction.type, "buy"),
        gte(transaction.tradeDate, cutoff),
      ),
    );
  let buyTotal = new Decimal(0);
  for (const b of buys) {
    if (b.currency !== currency) continue;
    buyTotal = buyTotal.plus(new Decimal(b.quantity).times(new Decimal(b.price)));
  }
  const monthlyContribution = buyTotal.dividedBy(12);

  const defaults: GoalDefaultsDTO = {
    currency,
    divYieldPct: divYieldPct?.toFixed(2) ?? null,
    divGrowthPct: divGrowthPct?.toFixed(2) ?? null,
    annualReturnPct: annualReturnPct?.toFixed(2) ?? null,
    monthlyContribution: monthlyContribution.toFixed(2),
    inflationPct: DEFAULT_INFLATION_PCT,
    dividendTaxRate: incomeView.dividendTaxRate,
  };

  if (!goalRow) return { goal: null, defaults, result: null };

  // The goal's currency is fixed at save time, but the computation currency
  // above is recomputed fresh on every GET (display currency, or the single
  // native currency). If the user changed their display currency since
  // saving, the stored amount is in a different currency than `currency` —
  // comparing them would silently produce wrong numbers. Bail out with a
  // reason instead; the form (with defaults) still renders so the user can
  // save again to recalculate.
  if (goalRow.currency !== currency) {
    return {
      goal: goalDTO,
      defaults,
      result: null,
      reason: `goal was saved in ${goalRow.currency} but your display currency is now ${currency} — save the goal again to recalculate`,
      reasonCode: "goal_currency_stale",
    };
  }

  // ---- Result ----
  const currentYear = new Date().getFullYear();
  // Stale goals (target year already passed) still render: clamp to 1 year out.
  const targetYears = Math.max(1, goalRow.targetYear - currentYear);
  const inflationPct = new Decimal(goalRow.inflationPct);
  const contributionGrowthPct =
    goalRow.contributionIncrease === "none"
      ? new Decimal(0)
      : goalRow.contributionIncrease === "custom"
        ? new Decimal(goalRow.contributionIncreasePct ?? "0")
        : inflationPct;

  const netMode = goalRow.type === "passive_income" && incomeView.dividendTaxRate != null;

  const params: GoalProjectionParams = {
    mode: goalRow.type === "passive_income" ? "income" : "value",
    startValue: marketValue,
    goalAmount: new Decimal(goalRow.amount),
    targetYears,
    monthlyContribution: new Decimal(goalRow.monthlyContribution ?? defaults.monthlyContribution),
    contributionGrowthPct,
    // The yield-override field only exists on the income-mode form; in value
    // mode a stale override left over from a previous income-mode edit must
    // not silently subtract from the return, so always use the computed
    // default there.
    divYieldPct: new Decimal(
      (goalRow.type === "passive_income" ? goalRow.divYieldPct : null) ??
        defaults.divYieldPct ??
        "0",
    ),
    divGrowthPct: new Decimal(goalRow.divGrowthPct ?? defaults.divGrowthPct ?? "0"),
    annualReturnPct: new Decimal(goalRow.annualReturnPct ?? defaults.annualReturnPct ?? "0"),
    inflationPct,
    adjustGoalForInflation: goalRow.adjustGoalForInflation,
    reinvestDividends: goalRow.reinvestDividends,
    incomeTaxPct: netMode ? new Decimal(incomeView.dividendTaxRate!) : null,
    maxYears: MAX_SIM_YEARS,
  };

  const portfolioSim = simulateGoal(params);
  const alternative = goalRow.suggestAlternative
    ? solveAlternativeScenario(params, targetYears)
    : null;
  const alternativeSim = alternative ? simulateGoal(alternative.params) : null;

  // Trim the presented range: through the slowest achievement (or target)+1.
  const achievedOffsets = [portfolioSim.achievedInYears, alternativeSim?.achievedInYears].filter(
    (v): v is number => v != null,
  );
  const lastOffset = Math.min(
    MAX_SIM_YEARS,
    Math.max(targetYears, ...(achievedOffsets.length ? achievedOffsets : [0])) + 1,
  );

  const rowsToDTO = (rows: GoalYearRow[]): GoalYearRowDTO[] =>
    rows.slice(0, lastOffset + 1).map((r) => ({
      yearOffset: r.yearOffset,
      year: currentYear + r.yearOffset,
      goal: r.goal.toFixed(2),
      annualContribution: r.annualContribution.toFixed(2),
      monthlyContribution: r.monthlyContribution.toFixed(2),
      value: r.value.toFixed(2),
      income: r.income.toFixed(2),
      achieved: r.achieved,
    }));

  const paramsToDTO = (p: GoalProjectionParams): GoalScenarioDTO["params"] => ({
    divYieldPct: p.divYieldPct.toFixed(2),
    divGrowthPct: p.divGrowthPct.toFixed(2),
    annualReturnPct: p.annualReturnPct.toFixed(2),
    monthlyContribution: p.monthlyContribution.toFixed(2),
    contributionGrowthPct: p.contributionGrowthPct.toFixed(2),
    reinvestDividends: p.reinvestDividends,
  });

  const scenarios: GoalScenarioDTO[] = [
    {
      id: "portfolio",
      params: paramsToDTO(params),
      achievedInYears: portfolioSim.achievedInYears,
      achievedYear:
        portfolioSim.achievedInYears == null ? null : currentYear + portfolioSim.achievedInYears,
      rows: rowsToDTO(portfolioSim.rows),
    },
  ];
  if (alternative && alternativeSim) {
    scenarios.push({
      id: "alternative",
      params: paramsToDTO(alternative.params),
      changed: alternative.changed.map((c) => ({
        key: c.key,
        from: c.from.toFixed(2),
        to: c.to.toFixed(2),
      })),
      achievedInYears: alternativeSim.achievedInYears,
      achievedYear:
        alternativeSim.achievedInYears == null
          ? null
          : currentYear + alternativeSim.achievedInYears,
      rows: rowsToDTO(alternativeSim.rows),
    });
  }

  const goalAtTarget = params.adjustGoalForInflation
    ? params.goalAmount.times(new Decimal(1).plus(inflationPct.dividedBy(100)).pow(targetYears))
    : params.goalAmount;
  const currentMetric =
    params.mode === "income" ? portfolioSim.rows[0]!.income : portfolioSim.rows[0]!.value;
  const progressPct = goalAtTarget.greaterThan(0)
    ? Number(currentMetric.dividedBy(goalAtTarget).times(100).toFixed(2))
    : 0;

  const result: GoalResultDTO = {
    netMode,
    currency,
    progressPct,
    currentMetric: currentMetric.toFixed(2),
    goalAtTargetYear: goalAtTarget.toFixed(2),
    targetYear: goalRow.targetYear,
    achievedInYears: portfolioSim.achievedInYears,
    achievedYear:
      portfolioSim.achievedInYears == null ? null : currentYear + portfolioSim.achievedInYears,
    scenarios,
  };

  return { goal: goalDTO, defaults, result };
}
