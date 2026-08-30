import { inArray } from "drizzle-orm";
import type { INewsProvider, NewsArticle } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { newsCache, type StoredNewsArticle } from "../db/schema";
import { loadPortfolioBook } from "./portfolio-book";
import { buildPortfolioView, type PortfolioViewDeps } from "./portfolio-view";
import { Decimal } from "@sage/core";

const NEWS_TTL_MS = 30 * 60_000;
const BUDGET = 12; // Yahoo has no hard daily quota; refresh a healthy slice per trigger

function toStored(a: NewsArticle): StoredNewsArticle {
  return {
    title: a.title,
    publisher: a.publisher,
    url: a.url,
    publishedAt: a.publishedAt.toISOString(),
    thumbnailUrl: a.thumbnailUrl,
    relatedSymbols: a.relatedSymbols,
  };
}

/** An article plus the held symbols it is associated with. */
export interface MergedNewsArticle extends StoredNewsArticle {
  /** The cache rows this article was stored under (authoritative — it was
   *  fetched *for* those symbols) plus any related tickers the user holds. */
  matchedSymbols: string[];
}

/** Merge per-symbol cache rows into one feed, deduped by URL, sorted by
 *  recency, and capped to `cap`. Callers that rank the result by relevance
 *  (see `rankPortfolioNews`) must pass an uncapped pool here and slice
 *  *after* ranking — capping first would throw away low-recency,
 *  high-relevance articles before they're ever scored. The default `cap`
 *  only applies to callers that use the merged list as-is, without ranking. */
export function mergeAndDedupeNews(
  lists: { symbol: string; articles: StoredNewsArticle[] }[],
  held: Set<string>,
  cap = 50,
): MergedNewsArticle[] {
  const byUrl = new Map<string, MergedNewsArticle>();
  for (const { symbol, articles } of lists)
    for (const article of articles) {
      const existing = byUrl.get(article.url);
      const matched = new Set(existing?.matchedSymbols ?? []);
      matched.add(symbol);
      for (const related of article.relatedSymbols) if (held.has(related)) matched.add(related);
      // Keep the newest copy's fields, but the union of every copy's symbols.
      const newest = !existing || article.publishedAt > existing.publishedAt ? article : existing;
      byUrl.set(article.url, { ...newest, matchedSymbols: [...matched] });
    }
  return [...byUrl.values()]
    .sort((x, y) => (x.publishedAt < y.publishedAt ? 1 : x.publishedAt > y.publishedAt ? -1 : 0))
    .slice(0, cap);
}

// --- Relevance ranking -------------------------------------------------
// Tunable without re-reading the algebra. See the design doc for rationale.

/** Articles older than this never reach the feed. */
export const NEWS_MAX_AGE_DAYS = 14;
/** Hours after which an article's recency factor halves. */
export const NEWS_RECENCY_HALF_LIFE_HOURS = 36;
/** A day move of this size (percent, absolute) earns full mover credit. */
export const NEWS_FULL_MOVE_PERCENT = 4;
/** How hard each extra tagged ticker discounts an article. */
export const NEWS_FOCUS_DECAY = 0.35;
/** Split of the relevance term between position weight and today's move. */
export const NEWS_WEIGHT_SHARE = 0.6;
/** Max articles returned by `getPortfolioNews`. Applied *after* ranking, so
 *  relevance decides what gets cut rather than recency. */
export const NEWS_FEED_CAP = 50;

/** A held position reduced to the signals that decide news relevance. */
export interface NewsHolding {
  symbol: string;
  name: string;
  /** Share of portfolio market value, 0..1. Zero when the book's values don't
   *  resolve to a single currency — see `buildNewsHoldings`. */
  weight: number;
  dayChangePercent: number | null;
  website: string | null;
}

/** An article attributed to the holding it is about. */
export interface RankedNewsArticle extends StoredNewsArticle {
  holding: {
    symbol: string;
    name: string;
    weightPct: number;
    dayChangePercent: number | null;
    website: string | null;
  };
  /** Other held symbols the article also matched, largest first. */
  otherSymbols: string[];
}

/** Relevance of one article to its primary holding. Higher ranks earlier.
 *
 *  score = (weight·0.6 + move·0.4) · focus · recency
 *
 *  `focus` is not cosmetic: without it, weight ranking would systematically
 *  promote twelve-ticker roundups, since such an article matches the reader's
 *  *largest* holding by construction and inherits its top weight score. */
function scoreNewsArticle(
  article: MergedNewsArticle,
  primary: NewsHolding,
  maxWeight: number,
  now: Date,
): number {
  const ageHours = (now.getTime() - Date.parse(article.publishedAt)) / 3_600_000;
  const weightScore = maxWeight > 0 ? primary.weight / maxWeight : 0;
  const moveScore =
    primary.dayChangePercent == null
      ? 0
      : Math.min(Math.abs(primary.dayChangePercent) / NEWS_FULL_MOVE_PERCENT, 1);
  const tickerCount = Math.max(article.relatedSymbols.length, 1);
  const focus = 1 / (1 + NEWS_FOCUS_DECAY * (tickerCount - 1));
  const recency = Math.pow(0.5, ageHours / NEWS_RECENCY_HALF_LIFE_HOURS);
  const relevance = NEWS_WEIGHT_SHARE * weightScore + (1 - NEWS_WEIGHT_SHARE) * moveScore;
  return relevance * focus * recency;
}

/** Sort the merged feed by portfolio relevance and attribute each article to
 *  the largest holding it matched. Articles matching nothing still held (a
 *  position sold since the cache row was written) are dropped. Sort is stable,
 *  so equal scores keep the merge's recency order. */
export function rankPortfolioNews(
  articles: MergedNewsArticle[],
  holdings: NewsHolding[],
  now: Date,
): RankedNewsArticle[] {
  const bySymbol = new Map(holdings.map((h) => [h.symbol, h]));
  const maxWeight = holdings.reduce((max, h) => Math.max(max, h.weight), 0);
  const cutoff = now.getTime() - NEWS_MAX_AGE_DAYS * 86_400_000;

  const scored: { article: RankedNewsArticle; score: number }[] = [];
  for (const article of articles) {
    if (Date.parse(article.publishedAt) < cutoff) continue;
    const matched = article.matchedSymbols
      .map((s) => bySymbol.get(s))
      .filter((h): h is NewsHolding => h !== undefined)
      .sort((x, y) => y.weight - x.weight);
    const primary = matched[0];
    if (!primary) continue;
    scored.push({
      score: scoreNewsArticle(article, primary, maxWeight, now),
      // Built field by field so `matchedSymbols` stays an internal detail
      // rather than leaking into the JSON response.
      article: {
        title: article.title,
        publisher: article.publisher,
        url: article.url,
        publishedAt: article.publishedAt,
        thumbnailUrl: article.thumbnailUrl,
        relatedSymbols: article.relatedSymbols,
        holding: {
          symbol: primary.symbol,
          name: primary.name,
          weightPct: Number((primary.weight * 100).toFixed(2)),
          dayChangePercent: primary.dayChangePercent,
          website: primary.website,
        },
        otherSymbols: matched.slice(1).map((h) => h.symbol),
      },
    });
  }
  return scored.sort((x, y) => y.score - x.score).map((s) => s.article);
}

/** The slice of a portfolio-view position that news ranking needs. */
export interface NewsHoldingInput {
  symbol: string;
  name: string;
  marketValue: { amount: string; currency: string } | null;
  dailyChangePercent: number | null;
  website: string | null;
}

/** Reduce portfolio-view positions to ranking signals.
 *
 *  Weights are a share of total market value, but only when every priced
 *  position's converted value lands in ONE currency — the same honesty rule
 *  `buildPortfolioView` applies to portfolio-level todayChange. A mixed set
 *  would make the shares meaningless, so every weight falls back to 0 and
 *  ranking leans on the mover, focus and recency terms instead. */
export function buildNewsHoldings(positions: NewsHoldingInput[]): NewsHolding[] {
  const priced = positions.filter(
    (p): p is NewsHoldingInput & { marketValue: { amount: string; currency: string } } =>
      p.marketValue !== null,
  );
  const currencies = new Set(priced.map((p) => p.marketValue.currency));
  const total =
    currencies.size === 1
      ? priced.reduce((sum, p) => sum.plus(new Decimal(p.marketValue.amount)), new Decimal(0))
      : new Decimal(0);

  return positions.map((p) => ({
    symbol: p.symbol,
    name: p.name,
    // A ranking weight, not an accounting figure — Decimal does the division,
    // then it crosses into `number` because that's what the score consumes.
    weight:
      total.isZero() || !p.marketValue
        ? 0
        : Number(new Decimal(p.marketValue.amount).dividedBy(total).toFixed(6)),
    dayChangePercent: p.dailyChangePercent,
    website: p.website,
  }));
}

export function pickStaleNewsSymbols(
  lastFetched: Map<string, Date | null>,
  now: Date,
  ttlMs = NEWS_TTL_MS,
  budget = BUDGET,
): string[] {
  const cutoff = now.getTime() - ttlMs;
  const never: string[] = [];
  const stale: { symbol: string; at: number }[] = [];
  for (const [symbol, at] of lastFetched) {
    if (at === null) never.push(symbol);
    else if (at.getTime() <= cutoff) stale.push({ symbol, at: at.getTime() });
  }
  stale.sort((x, y) => x.at - y.at);
  return [...never, ...stale.map((s) => s.symbol)].slice(0, budget);
}

async function upsertNews(
  db: Database,
  symbol: string,
  articles: StoredNewsArticle[],
): Promise<void> {
  await db
    .insert(newsCache)
    .values({ symbol, articles, fetchedAt: new Date() })
    .onConflictDoUpdate({ target: newsCache.symbol, set: { articles, fetchedAt: new Date() } });
}

let inFlight = false;
async function triggerStaleNewsSync(
  db: Database,
  provider: INewsProvider,
  symbols: string[],
): Promise<void> {
  if (inFlight || symbols.length === 0) return;
  inFlight = true;
  try {
    const rows = await db
      .select({ symbol: newsCache.symbol, fetchedAt: newsCache.fetchedAt })
      .from(newsCache)
      .where(inArray(newsCache.symbol, symbols));
    const last = new Map<string, Date | null>(symbols.map((s) => [s, null]));
    for (const r of rows) last.set(r.symbol, r.fetchedAt);
    const picked = pickStaleNewsSymbols(last, new Date());
    for (const symbol of picked) {
      try {
        const fresh = (await provider.getNews(symbol)).map(toStored);
        await upsertNews(db, symbol, fresh);
      } catch (err) {
        console.warn(`news sync failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    inFlight = false;
  }
}

export async function getSymbolNews(
  db: Database,
  provider: INewsProvider,
  symbol: string,
): Promise<StoredNewsArticle[]> {
  const [row] = await db
    .select()
    .from(newsCache)
    .where(inArray(newsCache.symbol, [symbol]));
  if (row) {
    if (row.fetchedAt.getTime() <= Date.now() - NEWS_TTL_MS) {
      void triggerStaleNewsSync(db, provider, [symbol]).catch(() => {});
    }
    return row.articles;
  }
  // Cold: fetch once inline, store, return.
  const fresh = (await provider.getNews(symbol)).map(toStored);
  await upsertNews(db, symbol, fresh);
  return fresh;
}

export async function getPortfolioNews(
  deps: PortfolioViewDeps,
  newsProvider: INewsProvider,
  userId: string,
): Promise<RankedNewsArticle[]> {
  const { db } = deps;
  const book = await loadPortfolioBook(db, userId);
  const symbols = book.positions.map((p) => p.symbol);
  if (symbols.length === 0) return [];

  const rows = await db.select().from(newsCache).where(inArray(newsCache.symbol, symbols));
  void triggerStaleNewsSync(db, newsProvider, symbols).catch(() => {});

  // Uncapped here on purpose — rank first, cap after, so a recency-driven
  // pool never discards a high-relevance article before it's scored.
  const merged = mergeAndDedupeNews(
    rows.map((r) => ({ symbol: r.symbol, articles: r.articles })),
    new Set(symbols),
    Infinity,
  );
  // Nothing cached yet (the feed is cache-only by design) — skip the portfolio
  // view entirely so the cold path stays as cheap as a plain DB read.
  if (merged.length === 0) return [];

  const { body } = await buildPortfolioView(deps, userId, {
    currency: book.targetCurrency,
    book,
  });
  const ranked = rankPortfolioNews(merged, buildNewsHoldings(body.positions), new Date());
  return ranked.slice(0, NEWS_FEED_CAP);
}
