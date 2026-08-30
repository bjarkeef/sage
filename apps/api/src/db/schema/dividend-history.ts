import { pgTable, text, numeric, date, timestamp, unique, boolean } from "drizzle-orm/pg-core";
import { instrument } from "./instrument";

export const dividendHistory = pgTable(
  "dividend_history",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => instrument.symbol),
    exDate: date("ex_date").notNull(),
    amountPerShare: numeric("amount_per_share").notNull(),
    currency: text("currency").notNull(),
    paymentDate: date("payment_date"),
    recordDate: date("record_date"),
    declarationDate: date("declaration_date"),
    period: text("period"),
    paymentDateEstimated: boolean("payment_date_estimated").notNull().default(false),
    source: text("source").notNull().default("provider"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("dividend_history_symbol_ex_date").on(t.symbol, t.exDate)],
);
