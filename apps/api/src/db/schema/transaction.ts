import { pgTable, uuid, text, numeric, date, timestamp, index } from "drizzle-orm/pg-core";
import { portfolio } from "./portfolio";
import { instrument } from "./instrument";

export const transaction = pgTable(
  "transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolio.id),
    instrumentSymbol: text("instrument_symbol")
      .notNull()
      .references(() => instrument.symbol),
    type: text("type").notNull(), // "buy" | "sell" | "dividend" | "split"
    quantity: numeric("quantity").notNull(), // share count (string)
    price: numeric("price").notNull(), // per-share, instrument currency (string)
    currency: text("currency").notNull(),
    fee: numeric("fee"),
    feeCurrency: text("fee_currency"),
    /**
     * 'auto' = created by dividend auto-reconciliation; NULL = user/import.
     * Dividend transactions feed the performance view's cash flows; the
     * synthetic income views (dividend-income-view, portfolio-view) ignore them.
     */
    source: text("source"),
    tradeDate: date("trade_date").notNull(), // "YYYY-MM-DD"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Every portfolio view filters by portfolio_id; list sorts by trade_date.
    index("transaction_portfolio_id_idx").on(t.portfolioId),
    index("transaction_portfolio_trade_date_idx").on(t.portfolioId, t.tradeDate),
  ],
);
