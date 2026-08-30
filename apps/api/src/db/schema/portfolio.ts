import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const portfolio = pgTable(
  "portfolio",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Default"),
    /** Dividend auto-reconciliation on/off (spec: default ON). */
    autoAddDividends: boolean("auto_add_dividends").notNull().default(true),
    /** Last reconciliation run; NULL = never (or reset to force a run). */
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portfolio_user_id_idx").on(t.userId)],
);
