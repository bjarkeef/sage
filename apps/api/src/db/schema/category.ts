import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { portfolio } from "./portfolio";
import { instrument } from "./instrument";

/** A user-defined grouping of holdings with an optional target share of its
 *  parent (spec 2026-07-19, nested 2026-08-22). Categories nest: `parentId`
 *  null is a root category whose target is a share of the portfolio; a nested
 *  category's target is a share of the category above it. */
export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolio.id, { onDelete: "cascade" }),
    /** Enclosing category; null = root. Cascade matches the folder metaphor:
     *  deleting a category deletes its subtree. */
    parentId: uuid("parent_id").references((): AnyPgColumn => category.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    /** Target share of the PARENT's value, percent (e.g. "40"). For a root
     *  category the parent is the portfolio. */
    targetPct: numeric("target_pct"),
    /** Display order among siblings. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Sibling names are unique. Postgres treats NULLs as DISTINCT in a unique
    // constraint, so this one does nothing for root categories (parent_id is
    // null) — hence the partial index below, which is what actually keeps root
    // names unique. Both are needed; neither covers the other's rows.
    unique("category_portfolio_parent_name").on(t.portfolioId, t.parentId, t.name),
    uniqueIndex("category_portfolio_root_name_idx")
      .on(t.portfolioId, t.name)
      .where(sql`${t.parentId} is null`),
  ],
);

/** One row per categorized symbol. `categoryId = null` + `targetPct` set is a
 *  root-level asset target; `categoryId = null` + no target is meaningless and
 *  never written. No row at all = unallocated. Custom holdings participate
 *  automatically: they are `instrument` rows (assetType='custom'). `targetPct`
 *  on a row WITH a categoryId is that asset's target share of its category. */
export const categoryAssignment = pgTable(
  "category_assignment",
  {
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolio.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => instrument.symbol, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => category.id, { onDelete: "cascade" }),
    targetPct: numeric("target_pct"),
  },
  (t) => [unique("category_assignment_portfolio_symbol").on(t.portfolioId, t.symbol)],
);
