import { pgTable, uuid, text, date, timestamp, unique, index } from "drizzle-orm/pg-core";
import { portfolio } from "./portfolio";
import { transaction } from "./transaction";

/** One row = one provider dividend (symbol + ex-date) that auto-reconciliation
 *  has handled for a portfolio. The row PERSISTS when the transaction it
 *  created is deleted (FK goes NULL — the tombstone that stops the daily run
 *  from resurrecting a dividend the user removed). Mirrors import_row's
 *  ledger/tombstone pattern; identity here is provider-fact based
 *  (symbol + ex_date), NOT row-content based like import_row's row_hash. */
export const autoDividend = pgTable(
  "auto_dividend",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolio.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    exDate: date("ex_date").notNull(),
    transactionId: uuid("transaction_id").references(() => transaction.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("auto_dividend_identity").on(t.portfolioId, t.symbol, t.exDate),
    index("auto_dividend_transaction_id_idx").on(t.transactionId),
  ],
);
