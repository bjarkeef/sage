import type { GoalViewDTO } from "../types";

/** A goal line is drawn only while it fits: above this multiple of the tallest
 *  year it would squash every bar to a sliver (a 231,728 goal over ~6,000 of
 *  income leaves them at 2.6% of the ribbon). */
export const GOAL_FIT_RATIO = 1.6;

export type GoalMark =
  | { kind: "none" }
  | { kind: "line"; amount: number; label: string }
  | { kind: "caption"; text: string };

export interface GoalMarkInput {
  goal: GoalViewDTO | null | undefined;
  displayCurrency: string;
  focused: boolean;
  years: { year: number; total: number }[];
  currentYearTotal: number;
}

const money = (amount: number, currency: string) =>
  `${currency} ${Math.round(amount).toLocaleString("en-US")}`;

/** No goal, or a goal the ribbon cannot honestly draw, is "none": inviting a
 *  goal is the goal band's job, not the ribbon's. */
export function goalMark(input: GoalMarkInput): GoalMark {
  const { goal, displayCurrency, focused, years, currentYearTotal } = input;
  const g = goal?.goal;
  const r = goal?.result;
  if (!g || !r || g.type !== "passive_income") return { kind: "none" };
  if (r.currency !== displayCurrency || focused) return { kind: "none" };

  // The figure `progressPct` is measured against, and net of tax like the bars.
  const amount = Number(r.goalAtTargetYear);
  if (!(amount > 0)) return { kind: "none" };

  const tallest = Math.max(0, ...years.map((y) => y.total));
  if (amount > tallest * GOAL_FIT_RATIO) {
    const pct = (currentYearTotal / amount) * 100;
    return {
      kind: "caption",
      text: `Goal: ${money(amount, r.currency)} a year by ${r.targetYear} — ${pct.toFixed(1)}% of it this year`,
    };
  }

  const reached = years.find((y) => y.total >= amount)?.year ?? null;
  return {
    kind: "line",
    amount,
    label: `GOAL ${money(amount, r.currency)}${reached != null ? ` · first reached in ${reached}` : ""}`,
  };
}
