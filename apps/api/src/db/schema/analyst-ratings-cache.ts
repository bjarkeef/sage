import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { instrument } from "./instrument";

export interface StoredMoney {
  amount: string;
  currency: string;
}
export interface StoredRatingChange {
  firm: string;
  fromGrade: string | null;
  toGrade: string;
  action: string;
  date: string;
}
/** Stored/wire analyst-ratings shape (dates ISO, money as {amount,currency}). */
export interface StoredAnalystRatings {
  consensusKey: "strongBuy" | "buy" | "hold" | "sell" | "strongSell" | null;
  distribution: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number };
  targets: {
    low: StoredMoney | null;
    mean: StoredMoney | null;
    high: StoredMoney | null;
    median: StoredMoney | null;
  };
  currentPrice: StoredMoney | null;
  analystCount: number;
  asOf: string;
  upgradeHistory: StoredRatingChange[];
}

/** Per-symbol analyst-ratings cache. A row with `data = null` records that we
 *  checked and the provider has no coverage, so sparse symbols aren't re-fetched
 *  on every view. Row absent = never checked. */
export const analystRatingsCache = pgTable("analyst_ratings_cache", {
  symbol: text("symbol")
    .primaryKey()
    .references(() => instrument.symbol),
  data: jsonb("data").$type<StoredAnalystRatings>(), // nullable
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
