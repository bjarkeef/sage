import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  date,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { instrument } from "./instrument";
import { portfolio } from "./portfolio";
import { transaction } from "./transaction";

/** Settings for a user-defined ("custom") instrument — the Snowball
 *  custom-holding model (spec 2026-07-18). One row per custom instrument;
 *  the instrument row (assetType='custom') is the discriminator the market
 *  data routing keys off. Tax is NOT here: the income engine reads the global
 *  user.dividendTaxRate. */
export const customHolding = pgTable("custom_holding", {
  symbol: text("symbol")
    .primaryKey()
    .references(() => instrument.symbol, { onDelete: "cascade" }),
  portfolioId: uuid("portfolio_id")
    .notNull()
    .references(() => portfolio.id, { onDelete: "cascade" }),
  /** "savings" | "pension" | "other" */
  holdingType: text("holding_type").notNull().default("other"),
  sector: text("sector"),
  country: text("country"),
  note: text("note"),
  incomeEnabled: boolean("income_enabled").notNull().default(false),
  /** Annual income rate, percent (e.g. "4.25"). */
  incomeYearlyPct: numeric("income_yearly_pct"),
  /** "week" | "month" | "quarter" | "year" */
  frequencyUnit: text("frequency_unit"),
  frequencyInterval: integer("frequency_interval").notNull().default(1),
  firstPaymentDate: date("first_payment_date"),
  lastPaymentDate: date("last_payment_date"),
  /** Engine materializes due payments automatically. */
  autoAdd: boolean("auto_add").notNull().default(true),
  /** Net income credited as shares (price-0 buy) instead of cash. */
  reinvest: boolean("reinvest").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** User-entered price marks for custom instruments; the manual-price provider
 *  serves quotes/bars from these (falling back to transaction prices). */
export const manualPrice = pgTable(
  "manual_price",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => instrument.symbol, { onDelete: "cascade" }),
    date: date("date").notNull(),
    price: numeric("price").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("manual_price_symbol_date").on(t.symbol, t.date)],
);

/** One row = one scheduled income payment the engine has handled. Mirrors
 *  auto_dividend's ledger/tombstone contract: the row PERSISTS when its
 *  transaction is deleted (FK goes null) so a user-deleted payment is never
 *  resurrected. Identity is schedule-fact based: (portfolio, symbol, payDate). */
export const customIncome = pgTable(
  "custom_income",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolio.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    payDate: date("pay_date").notNull(),
    transactionId: uuid("transaction_id").references(() => transaction.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("custom_income_identity").on(t.portfolioId, t.symbol, t.payDate),
    index("custom_income_transaction_id_idx").on(t.transactionId),
  ],
);
