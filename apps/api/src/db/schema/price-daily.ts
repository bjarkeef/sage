import { pgTable, text, date, numeric, timestamp, primaryKey } from "drizzle-orm/pg-core";

/**
 * Daily price bars, one row per (symbol, trading day).
 *
 * Deliberately NOT foreign-keyed to `instrument`: benchmark series
 * (`fetchBenchmarkSeries`) price index tickers that have no instrument row, and
 * a FK would reject them on insert.
 *
 * Deliberately NOT scoped to a user or portfolio: a close is a fact about the
 * market, identical for everyone holding the symbol. One shared row keeps
 * upstream cost at one fetch per symbol per interval for the whole instance.
 *
 * All of OHLC and volume are stored though only `close` is read today. The
 * alternative — storing `close` alone — would mean fabricating the rest on read
 * to satisfy `PriceBar`, which silently lies to any future consumer.
 */
export const priceDaily = pgTable(
  "price_daily",
  {
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),
    open: numeric("open").notNull(),
    high: numeric("high").notNull(),
    low: numeric("low").notNull(),
    close: numeric("close").notNull(),
    volume: numeric("volume").notNull(),
    /** The bar's own currency, authoritative and possibly different from the
     *  currency the user paid in. Yahoo pre-normalises GBp→GBP. */
    currency: text("currency").notNull(),
    /** Our clock: when we last successfully reached the provider for this row.
     *  Distinct from the bar's `date`, which is market time. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The primary key is already symbol-leading, which is the only access pattern
  // (range scan per symbol), so no secondary index is needed. `fx_rate_daily`
  // carries one only because its key is date-leading.
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);
