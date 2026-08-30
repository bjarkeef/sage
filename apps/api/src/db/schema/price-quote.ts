import { pgTable, text, numeric, timestamp } from "drizzle-orm/pg-core";

/**
 * The latest known quote per symbol.
 *
 * Separate from `price_daily` because a quote is intraday and a bar is a
 * settled day; merging them would need an "is this row final?" flag. Separate
 * from `instrument` because that table is identity and metadata, this is
 * observation.
 *
 * Two clocks, both needed:
 *  - `asOf`      — the provider's market timestamp; when the price was struck.
 *  - `fetchedAt` — our clock; when we last reached the provider.
 *
 * Staleness is judged on `fetchedAt`. Judging on `asOf` would flag every
 * weekend and market holiday on a perfectly healthy instance, because Friday's
 * close is genuinely still the current price on Sunday.
 *
 * No FK and no tenant column, for the same reasons as `price_daily`.
 */
export const priceQuote = pgTable("price_quote", {
  symbol: text("symbol").primaryKey(),
  price: numeric("price").notNull(),
  currency: text("currency").notNull(),
  previousClose: numeric("previous_close"),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
