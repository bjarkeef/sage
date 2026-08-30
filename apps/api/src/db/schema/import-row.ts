import { pgTable, uuid, text, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { portfolio } from "./portfolio";
import { transaction } from "./transaction";

/** One row = one CSV row that has been imported once. The row PERSISTS when
 *  the transaction it created is edited (FK still set) or deleted (FK goes
 *  NULL — the tombstone that lets re-imports distinguish "deleted in Sage"
 *  from "never imported"). `source` is observability only; it is NOT part of
 *  the row identity, so the same trade arriving via a different importer is
 *  still recognized. */
export const importRow = pgTable(
  "import_row",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolio.id),
    source: text("source").notNull(),
    rowHash: text("row_hash").notNull(),
    occurrence: integer("occurrence").notNull().default(0),
    transactionId: uuid("transaction_id").references(() => transaction.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("import_row_identity").on(t.portfolioId, t.rowHash, t.occurrence),
    index("import_row_transaction_id_idx").on(t.transactionId),
  ],
);
