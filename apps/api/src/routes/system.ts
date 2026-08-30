import { Hono } from "hono";
import { inArray, sql } from "drizzle-orm";
import { Decimal } from "@sage/core";
import type { IFxRateService } from "@sage/provider-interface";
import type { AppEnv } from "../middleware/session";
import type { Database } from "../db/client";
import { dividendHistory, instrument } from "../db/schema";
import { loadPortfolioBook, type PortfolioBook } from "../services/portfolio-book";
import { getRatesWithProvenance } from "../market-data/fx-provenance";
import { earliestStoredDate } from "../market-data/ecb-sync";
import { PriceStore } from "../market-data/price-store";
import { arePricesStale } from "../market-data/price-freshness";
import type {
  ProviderHealthRegistry,
  ProviderFailureReason,
  ProviderState,
} from "../market-data/provider-health";

export interface FxPairStatus {
  /** The held/foreign currency. */
  from: string;
  /** The display currency. */
  to: string;
  /** Decimal string: units of `to` per 1 `from` — i.e. `getRate(from, to)`
   *  semantics, the direction a human reads ("1 USD = 6.5708 DKK"). The
   *  underlying lookup is the inverse, so this is inverted here rather than in
   *  the client. Null when unpriceable. */
  rate: string | null;
  /** `ecb` = cross-rated off the stored ECB reference series; `unavailable` =
   *  nothing could price it, so amounts pass through unconverted (the
   *  `fxIncomplete` condition). */
  source: "ecb" | "unavailable";
}

export interface FxStatusBody {
  displayCurrency: string | null;
  /** ECB publication day the displayed rates come from (`YYYY-MM-DD`); null
   *  when nothing is stored yet or nothing is being converted. */
  ratesAsOf: string | null;
  /** Earliest publication day held in `fx_rate_daily` (`YYYY-MM-DD`); null
   *  when the table is empty. Shows how far back historical conversions can
   *  reach, independent of which pairs this user's book happens to need. */
  coverageFrom: string | null;
  /** One row per currency the book needs converting; empty when nothing is
   *  being converted (no display currency, or everything already in it). */
  pairs: FxPairStatus[];
}

/**
 * Deployment facts this route is allowed to report, derived from `Env` by the
 * composition root and passed in already sanitised.
 *
 * The route deliberately never receives `Env` itself: it holds the API key
 * VALUES, and a handler whose job is to serialise its input must not be given
 * secrets in the first place. Keys are reduced to booleans here, so there is
 * nothing sensitive left to leak.
 */
export interface SystemInfo {
  nodeEnv: "development" | "test" | "production";
  signupsOpen: boolean;
  marketData: string;
  enrichment: string;
  /** Whether each API key is configured — never the value. */
  keys: { eodhd: boolean };
}

export interface EnvironmentBody {
  nodeEnv: string;
  nodeVersion: string;
  /** Seconds since this API process started. A low number explains a cache
   *  that just went cold and an FX provider that is being retried. */
  uptimeSeconds: number;
  signups: "open" | "closed";
  /** Applied Drizzle migrations; null when the internal table is unreadable. */
  schemaMigrations: number | null;
}

/** How one upstream provider has behaved since this process started.
 *
 *  Ages are sent as elapsed seconds computed on the server, matching
 *  `EnvironmentBody.uptimeSeconds`. An absolute timestamp would be read against
 *  the browser's clock, and "last success 4h ago" must not depend on the two
 *  agreeing. */
export interface ProviderHealthStatus {
  name: string;
  /** `unknown` = configured but not called since boot. */
  state: ProviderState;
  lastSuccessSecondsAgo: number | null;
  lastFailureSecondsAgo: number | null;
  lastFailureReason: ProviderFailureReason | null;
  consecutiveFailures: number;
}

export interface ProvidersBody {
  marketData: string;
  enrichment: string;
  keys: { eodhd: boolean };
  /** One row per provider the composition root wired; empty when no registry
   *  was supplied (tests, and any embedder that skips it). */
  health: ProviderHealthStatus[];
  /** Age of the OLDEST successful price fetch across the caller's holdings, in
   *  elapsed whole seconds — server-computed, like the health ages, so it never
   *  depends on the browser clock. Null when no price is stored yet. */
  pricesAgeSeconds: number | null;
  /** Whether that age exceeds the user-facing staleness threshold. Read from
   *  Postgres rather than the in-memory health registry, so it survives a
   *  restart: after a reboot mid-outage the registry reads `unknown` while the
   *  data is still days old. */
  pricesStale: boolean;
  /** How many of the caller's held symbols have no stored quote at all.
   *  Separate from `pricesStale` because it is the opposite failure: a fresh
   *  instance whose first fetch lands during an outage has no age to be old,
   *  so `pricesStale` is correctly false while every position is unpriceable.
   *  Without this the dashboard would be blank with nothing explaining it. */
  pricesMissing: number;
}

export interface SystemBody {
  environment: EnvironmentBody;
  providers: ProvidersBody;
  fx: FxStatusBody;
}

/** Drizzle's own bookkeeping table. Internal, so a failure here degrades to
 *  null rather than taking the whole panel down. */
async function countMigrations(db: Database): Promise<number | null> {
  try {
    const rows = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle."__drizzle_migrations"`,
    );
    const first = (rows as unknown as { count: string }[])[0];
    return first ? Number(first.count) : null;
  } catch {
    return null;
  }
}

/**
 * Read-only insight into the FX pipeline, for the Settings > System section.
 *
 * Deliberately scoped to the pairs THIS user's book needs rather than the whole
 * `fx_rate_daily` table, and it resolves them through the same
 * `getRatesWithProvenance` call the portfolio views use — so this page can
 * never disagree with the totals it is meant to explain.
 */
const DEFAULT_INFO: SystemInfo = {
  nodeEnv: "development",
  signupsOpen: true,
  marketData: "yahoo",
  enrichment: "none",
  keys: { eodhd: false },
};

/** The FX block: which rate each held currency is converting at, and where it
 *  came from. Split out so the handler reads as its three blocks. */
async function buildFxStatus(
  db: Database,
  book: PortfolioBook,
  fxRateService?: IFxRateService,
): Promise<FxStatusBody> {
  // Earliest stored publication day: how far back the ECB series reaches on
  // this instance. Shared with the sync module, which uses the same figure to
  // decide whether a full-history seed ever landed.
  const coverageFrom = await earliestStoredDate(db);
  const base = book.targetCurrency;

  if (!base) {
    return { displayCurrency: null, ratesAsOf: null, coverageFrom, pairs: [] };
  }

  // The currencies that actually have to convert: everything held, plus the
  // currencies dividends are paid in (a holding can pay in another currency).
  const currencies = new Set(book.positions.map((p) => p.currency));
  const heldSymbols = book.positions.map((p) => p.symbol);
  if (heldSymbols.length > 0) {
    const divRows = await db
      .select({ currency: dividendHistory.currency })
      .from(dividendHistory)
      .where(inArray(dividendHistory.symbol, heldSymbols));
    for (const d of divRows) currencies.add(d.currency);
  }
  currencies.delete(base);
  const targets = [...currencies].sort();

  if (targets.length === 0 || !fxRateService) {
    return { displayCurrency: base, ratesAsOf: null, coverageFrom, pairs: [] };
  }

  const { rates, asOf } = await getRatesWithProvenance(fxRateService, base, targets);

  const pairs: FxPairStatus[] = targets.map((foreign) => {
    const rate = rates.get(foreign);
    return {
      from: foreign,
      to: base,
      rate:
        rate && !rate.isZero()
          ? new Decimal(1).dividedBy(rate).toSignificantDigits(6).toString()
          : null,
      source: !rate ? "unavailable" : "ecb",
    };
  });

  return { displayCurrency: base, ratesAsOf: asOf, coverageFrom, pairs };
}

/**
 * The caller's held symbols that SHOULD have a row in `price_quote`.
 *
 * Excludes custom instruments. `CustomRoutingProvider` sits OUTSIDE
 * `Caching → PersistedPriceProvider` and routes `asset_type = 'custom'` to
 * `ManualPriceProvider` authoritatively with no fallthrough, so their prices
 * live in `manual_price` and by design never reach `PriceStore`. They are
 * priced perfectly well; they are simply priced somewhere else.
 *
 * This matters only because `pricesMissing` measures ABSENCE. The age query
 * was always immune — `min()` over an empty set contributes nothing — but a
 * count of what is missing cannot ignore a row the same way, so a single
 * savings or pension holding would pin the instance-wide callout on forever on
 * a completely healthy instance. Both queries take the filtered list, so a
 * custom holding cannot influence staleness at all.
 */
async function pricedSymbols(db: Database, book: PortfolioBook): Promise<string[]> {
  const held = [...new Set(book.positions.map((p) => p.symbol))];
  if (held.length === 0) return [];
  const rows = await db
    .select({ symbol: instrument.symbol, assetType: instrument.assetType })
    .from(instrument)
    .where(inArray(instrument.symbol, held));
  const custom = new Set(rows.filter((r) => r.assetType === "custom").map((r) => r.symbol));
  // A held symbol with no `instrument` row at all is kept: it is not known to
  // be custom, so it is still expected to have a quote.
  return held.filter((s) => !custom.has(s));
}

/** How old the caller's stored prices are, and how many are absent entirely.
 *  Scoped to held symbols: an unrelated stale row for a symbol this user does
 *  not own must not warn them. */
async function buildPriceAge(
  db: Database,
  book: PortfolioBook,
  now: number,
): Promise<{ pricesAgeSeconds: number | null; pricesStale: boolean; pricesMissing: number }> {
  const symbols = await pricedSymbols(db, book);
  const store = new PriceStore(db);
  const [oldest, pricesMissing] = await Promise.all([
    store.oldestQuoteFetch(symbols),
    store.countMissingQuotes(symbols),
  ]);
  if (oldest === null) return { pricesAgeSeconds: null, pricesStale: false, pricesMissing };
  return {
    pricesAgeSeconds: Math.max(0, Math.round((now - oldest.getTime()) / 1000)),
    pricesStale: arePricesStale(oldest, now),
    pricesMissing,
  };
}

/** Snapshot → wire shape: absolute millis become elapsed whole seconds. */
function toHealthStatus(
  registry: ProviderHealthRegistry | undefined,
  now: number,
): ProviderHealthStatus[] {
  if (!registry) return [];
  const elapsed = (at: number | null) =>
    at === null ? null : Math.max(0, Math.round((now - at) / 1000));
  return registry.snapshot().map((h) => ({
    name: h.name,
    state: h.state,
    lastSuccessSecondsAgo: elapsed(h.lastSuccessAt),
    lastFailureSecondsAgo: elapsed(h.lastFailureAt),
    lastFailureReason: h.lastFailureReason,
    consecutiveFailures: h.consecutiveFailures,
  }));
}

export function systemRoutes(
  db: Database,
  fxRateService?: IFxRateService,
  info: SystemInfo = DEFAULT_INFO,
  providerHealth?: ProviderHealthRegistry,
) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const userId = c.get("user").id;
    const now = Date.now();
    // Loaded ONCE and handed to both blocks: `loadPortfolioBook` re-selects the
    // whole transaction table and re-runs FIFO, which its own docstring says
    // should happen once per request.
    const book = await loadPortfolioBook(db, userId);
    const [fx, schemaMigrations, prices] = await Promise.all([
      buildFxStatus(db, book, fxRateService),
      countMigrations(db),
      buildPriceAge(db, book, now),
    ]);

    return c.json<SystemBody>({
      environment: {
        nodeEnv: info.nodeEnv,
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        signups: info.signupsOpen ? "open" : "closed",
        schemaMigrations,
      },
      providers: {
        marketData: info.marketData,
        enrichment: info.enrichment,
        keys: info.keys,
        health: toHealthStatus(providerHealth, now),
        ...prices,
      },
      fx,
    });
  });

  return app;
}
