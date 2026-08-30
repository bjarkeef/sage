import { pgTable, uuid, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { portfolio } from "./portfolio";

/** One goal per portfolio (Snowball parity: a single "My goal").
 *  Nullable parameter columns mean "use the computed default at calculation
 *  time" — resolution happens in the goal-view service, never here. */
export const goal = pgTable("goal", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id")
    .notNull()
    .unique()
    .references(() => portfolio.id, { onDelete: "cascade" }),
  /** "passive_income" | "value" */
  type: text("type").notNull(),
  /** Annual income or portfolio value, today's terms, in `currency`. */
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  /** Locked to the computation currency at save time (no goal-only FX in v1). */
  currency: text("currency").notNull(),
  targetYear: integer("target_year").notNull(),
  monthlyContribution: numeric("monthly_contribution", { precision: 18, scale: 2 }),
  /** "none" | "inflation" | "custom" */
  contributionIncrease: text("contribution_increase").notNull().default("inflation"),
  contributionIncreasePct: numeric("contribution_increase_pct", { precision: 5, scale: 2 }),
  divYieldPct: numeric("div_yield_pct", { precision: 5, scale: 2 }),
  divGrowthPct: numeric("div_growth_pct", { precision: 5, scale: 2 }),
  annualReturnPct: numeric("annual_return_pct", { precision: 5, scale: 2 }),
  adjustGoalForInflation: boolean("adjust_goal_for_inflation").notNull().default(true),
  inflationPct: numeric("inflation_pct", { precision: 5, scale: 2 }).notNull().default("2.5"),
  reinvestDividends: boolean("reinvest_dividends").notNull().default(true),
  suggestAlternative: boolean("suggest_alternative").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
