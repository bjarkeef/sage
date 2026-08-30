import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// `currency` is stored as plain text (a 3-letter ISO code), NOT char(3): a
// fixed CHAR pads with spaces, which would break equality on currency codes.
export const instrument = pgTable("instrument", {
  symbol: text("symbol").primaryKey(),
  name: text("name").notNull(),
  exchange: text("exchange").notNull(),
  currency: text("currency").notNull(),
  assetType: text("asset_type").notNull(),
  isin: text("isin"),
  primarySymbol: text("primary_symbol"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
