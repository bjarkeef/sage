import { pgTable, text, date, primaryKey, index } from "drizzle-orm/pg-core";

/**
 * ECB euro foreign exchange reference rates, one row per (publication day,
 * currency).
 *
 * Stored exactly as ECB publishes them — `rate` is a Decimal string holding
 * units of `currency` per 1 EUR — and cross-rated on read. Keeping ECB's own
 * EUR-based row (rather than materialising every pair) keeps all cross-pairs
 * internally consistent and keeps the table linear in currency count.
 *
 * EUR itself is never stored; it is implicitly 1.
 */
export const fxRateDaily = pgTable(
  "fx_rate_daily",
  {
    date: date("date").notNull(),
    currency: text("currency").notNull(),
    rate: text("rate").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.currency] }),
    // Series reads scan a date range across all currencies; spot reads want the
    // newest date. Both are date-leading, which the primary key already serves,
    // but currency-first lookups over a range benefit from this second index.
    index("fx_rate_daily_currency_date_idx").on(t.currency, t.date),
  ],
);
