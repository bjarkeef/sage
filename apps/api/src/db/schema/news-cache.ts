import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { instrument } from "./instrument";

/** One cached news article (wire/stored shape — dates are ISO strings). */
export interface StoredNewsArticle {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
  thumbnailUrl: string | null;
  relatedSymbols: string[];
}

/** Short-TTL per-symbol news cache: the whole article list is replaced on each
 *  refresh (no permanent history). Staleness is `fetchedAt` vs the news TTL. */
export const newsCache = pgTable("news_cache", {
  symbol: text("symbol")
    .primaryKey()
    .references(() => instrument.symbol),
  articles: jsonb("articles").$type<StoredNewsArticle[]>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
