import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { Money, Decimal } from "@sage/core";
import type { PriceBar, Quote } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { priceDaily, priceQuote } from "../db/schema";
import { toIsoDay } from "./price-freshness";

/**
 * Rows per `price_daily` INSERT.
 *
 * Postgres caps a single statement at 65,535 bind parameters. `price_daily`
 * binds 9 per row (symbol, date, OHLC, volume, currency, fetchedAt), so one
 * statement tops out at 7,281 rows — under 30 years of trading days, which a
 * routine `range=ALL` fetch of an old symbol exceeds (AAPL is ~11,300 bars).
 * 2000 rows is 18,000 parameters, comfortably clear with room for the row shape
 * to grow. Same reasoning and same shape as `ecb-sync`'s `CHUNK_SIZE`, just a
 * smaller number because that table has 3 columns to this one's 9.
 */
const BAR_CHUNK_SIZE = 2000;

/**
 * Keeps `column` at its stored value when the incoming observation is older.
 *
 * Applied per column rather than as a statement-wide `setWhere`, deliberately:
 * `fetched_at` must advance on EVERY successful write, because it means "when
 * we last reached the provider" and drives the user-facing staleness notice.
 * `as_of` is not monotonic across providers — Yahoo's mapper falls back to
 * `new Date()`, EODHD reports a second-granularity trade time, a day-granular
 * feed would disagree with both, and a Yahoo fallback sits behind every
 * non-Yahoo primary. Gating the whole statement on `as_of` therefore lets one
 * future-ish timestamp freeze the row forever: the price stops updating AND the
 * fetch clock stops with it, so the UI reports prices as days old while every
 * provider reads healthy.
 */
function keepNewer(column: string) {
  return sql.raw(
    `case when excluded.as_of >= price_quote.as_of then excluded.${column} else price_quote.${column} end`,
  );
}

/** A stored quote plus our own fetch clock, which the caller needs to decide
 *  whether to refresh. */
export interface StoredQuote {
  quote: Quote;
  fetchedAt: Date;
}

/** How far stored bars reach for one symbol, and when the newest was fetched. */
export interface BarCoverage {
  earliest: string;
  latest: string;
  newestFetchedAt: Date;
}

/**
 * Every read and write of `price_daily` and `price_quote`, and the only place
 * that maps between rows and `Money`/`PriceBar`.
 *
 * Kept free of policy: it never decides whether something is fresh enough to
 * serve. That belongs to PersistedPriceProvider, which makes this class
 * testable against a database with no notion of TTLs.
 */
export class PriceStore {
  constructor(private readonly db: Database) {}

  async readQuote(symbol: string): Promise<StoredQuote | null> {
    const [row] = await this.db.select().from(priceQuote).where(eq(priceQuote.symbol, symbol));
    if (!row) return null;
    return {
      quote: {
        symbol: row.symbol,
        price: Money.of(row.price, row.currency),
        asOf: row.asOf,
        previousClose:
          row.previousClose === null ? null : Money.of(row.previousClose, row.currency),
      },
      fetchedAt: row.fetchedAt,
    };
  }

  /** Upserts a quote, but never lets an older observation clobber a newer one.
   *  Two overlapping background refreshes for the same symbol can resolve out
   *  of order; without a guard, the older `as_of` would overwrite the newer
   *  price. The guard is per-column (see {@link keepNewer}) and deliberately
   *  excludes `fetchedAt`, which always advances: reaching the provider is a
   *  fact about our clock, independent of whose observation won. `>=`, not `>`:
   *  a provider that repeats an unchanged `as_of` after market close still
   *  writes through. */
  async writeQuote(quote: Quote, now: Date): Promise<void> {
    const values = {
      symbol: quote.symbol,
      price: quote.price.amount.toString(),
      currency: quote.price.currency,
      previousClose: quote.previousClose?.amount.toString() ?? null,
      asOf: quote.asOf,
      fetchedAt: now,
    };
    await this.db
      .insert(priceQuote)
      .values(values)
      .onConflictDoUpdate({
        target: priceQuote.symbol,
        set: {
          price: keepNewer("price"),
          currency: keepNewer("currency"),
          previousClose: keepNewer("previous_close"),
          asOf: keepNewer("as_of"),
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  async readBars(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
    const rows = await this.db
      .select()
      .from(priceDaily)
      .where(
        and(
          eq(priceDaily.symbol, symbol),
          gte(priceDaily.date, toIsoDay(from)),
          lte(priceDaily.date, toIsoDay(to)),
        ),
      )
      .orderBy(priceDaily.date);

    return rows.map((r) => ({
      // `date` columns round-trip as `YYYY-MM-DD`; anchor at UTC midnight so the
      // Date never lands on the previous day in a negative-offset timezone.
      date: new Date(`${r.date}T00:00:00Z`),
      open: Money.of(r.open, r.currency),
      high: Money.of(r.high, r.currency),
      low: Money.of(r.low, r.currency),
      close: Money.of(r.close, r.currency),
      volume: new Decimal(r.volume),
    }));
  }

  /** Idempotent: re-storing a day overwrites it, so any fetch can be replayed.
   *  `fetchedAt` is refreshed on every write, which is what lets a symbol whose
   *  history simply does not reach far enough stop being refetched forever.
   *  Chunked at {@link BAR_CHUNK_SIZE}; idempotency is what makes a chunked
   *  write safe to interrupt and replay. */
  async writeBars(symbol: string, bars: PriceBar[], now: Date): Promise<void> {
    if (bars.length === 0) return;
    const values = bars.map((b) => ({
      symbol,
      date: toIsoDay(b.date),
      open: b.open.amount.toString(),
      high: b.high.amount.toString(),
      low: b.low.amount.toString(),
      close: b.close.amount.toString(),
      volume: b.volume.toString(),
      currency: b.close.currency,
      fetchedAt: now,
    }));
    for (let i = 0; i < values.length; i += BAR_CHUNK_SIZE) {
      await this.db
        .insert(priceDaily)
        .values(values.slice(i, i + BAR_CHUNK_SIZE))
        .onConflictDoUpdate({
          target: [priceDaily.symbol, priceDaily.date],
          set: {
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
            currency: sql`excluded.currency`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    }
  }

  async coverage(symbol: string): Promise<BarCoverage | null> {
    const [row] = await this.db
      .select({
        earliest: sql<string | null>`min(${priceDaily.date})`,
        latest: sql<string | null>`max(${priceDaily.date})`,
        newestFetchedAt: sql<Date | null>`max(${priceDaily.fetchedAt})`,
      })
      .from(priceDaily)
      .where(eq(priceDaily.symbol, symbol));

    if (!row?.earliest || !row.latest || !row.newestFetchedAt) return null;
    return {
      earliest: row.earliest,
      latest: row.latest,
      newestFetchedAt: new Date(row.newestFetchedAt),
    };
  }

  /**
   * How many of `symbols` have no stored quote at all.
   *
   * Distinguishes "our prices are old" from "we have never had prices" — a
   * brand-new instance whose first fetch lands mid-outage stores nothing, so
   * it is not stale (there is no age to be old) but every position is
   * unpriceable and the user is owed an explanation. Deduplicated, and an
   * empty list short-circuits: `IN ()` is a SQL error.
   */
  async countMissingQuotes(symbols: string[]): Promise<number> {
    return (await this.missingQuoteSymbols(symbols)).length;
  }

  /** The given symbols that have no stored quote at all. */
  async missingQuoteSymbols(symbols: string[]): Promise<string[]> {
    const unique = [...new Set(symbols)];
    if (unique.length === 0) return [];
    const rows = await this.db
      .select({ symbol: priceQuote.symbol })
      .from(priceQuote)
      .where(inArray(priceQuote.symbol, unique));
    const stored = new Set(rows.map((r) => r.symbol));
    return unique.filter((s) => !stored.has(s));
  }

  /** Oldest successful fetch across the given symbols — the age the user is
   *  warned about. An empty list short-circuits: `IN ()` is a SQL error. */
  async oldestQuoteFetch(symbols: string[]): Promise<Date | null> {
    if (symbols.length === 0) return null;
    const [row] = await this.db
      .select({ oldest: sql<Date | null>`min(${priceQuote.fetchedAt})` })
      .from(priceQuote)
      .where(inArray(priceQuote.symbol, symbols));
    return row?.oldest ? new Date(row.oldest) : null;
  }
}
