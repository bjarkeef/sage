import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { parseEnv } from "./env";
import type { Env } from "./env";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { createAuth } from "./auth";
import type { IMarketDataProvider } from "@sage/provider-interface";
import { YahooFinanceProvider } from "@sage/provider-yahoo-finance";
import { EodhdProvider } from "@sage/provider-eodhd";
import { EcbFxFeed } from "@sage/provider-ecb";
import { CachingMarketDataProvider } from "./market-data/caching-provider";
import { EnrichingProvider } from "./market-data/enriching-provider";
import { FallbackMarketDataProvider } from "./market-data/fallback-provider";
import { EcbFxRateService } from "./market-data/ecb-fx-rate-service";
import { ensureRatesAvailable } from "./market-data/ecb-sync";
import { IsinResolver } from "./market-data/isin-resolver";
import { CustomRoutingProvider } from "./market-data/custom-routing-provider";
import { ManualPriceProvider } from "./market-data/manual-price-provider";
import { ProviderHealthRegistry } from "./market-data/provider-health";
import { HealthTrackingProvider } from "./market-data/health-tracking-provider";
import { PriceStore } from "./market-data/price-store";
import { PersistedPriceProvider } from "./market-data/persisted-price-provider";

/**
 * Migrations live beside this entry point in both layouts it ships in:
 * `src/db/migrations` under tsx in development, and `dist/db/migrations` in the
 * bundled image, where `scripts/copy-migrations.mjs` puts them. Resolving from
 * the ENTRY's own URL is what makes one expression correct for both — the
 * bundle flattens every other module into this file, so no other module's
 * location survives the build.
 */
const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), "db/migrations");

function createMarketDataProvider(env: Env, health: ProviderHealthRegistry): IMarketDataProvider {
  // Every LEAF adapter is wrapped, never the composites: only here do we know
  // a provider's name, and only a leaf is a single upstream. The several Yahoo
  // instances all report to one "yahoo" entry.
  const yahoo = () => new HealthTrackingProvider("yahoo", new YahooFinanceProvider(), health);
  const eodhd = () =>
    new HealthTrackingProvider(
      "eodhd",
      new EodhdProvider({ apiToken: env.EODHD_API_TOKEN! }),
      health,
    );
  let primary: IMarketDataProvider;
  switch (env.MARKET_DATA_PROVIDER) {
    case "yahoo":
      primary = yahoo();
      break;
    case "eodhd":
      primary = eodhd();
      break;
  }

  if (env.ENRICHMENT_PROVIDER === "yahoo" && env.MARKET_DATA_PROVIDER !== "yahoo") {
    primary = new EnrichingProvider(primary, yahoo());
  }

  // Fallback chain: when the primary can't serve a symbol (missing from its
  // universe, or a free-tier quota ran out) fall back to Yahoo, which has broad
  // coverage and no key requirement.
  if (env.MARKET_DATA_PROVIDER !== "yahoo") {
    return new FallbackMarketDataProvider([primary, yahoo()]);
  }

  return primary;
}

async function main() {
  const env = parseEnv();
  const { db } = createDb(env.DATABASE_URL);
  const auth = createAuth(db, env);
  await runMigrations(db, MIGRATIONS_FOLDER);
  const providerHealth = new ProviderHealthRegistry();
  // Prices are served from Postgres and refreshed behind the response, so a
  // provider outage shows up as an age rather than as missing data. Caching
  // stays OUTSIDE (it coalesces concurrent reads); the fallback chain and the
  // health trackers stay INSIDE, so a failure is recorded with its cause before
  // the store absorbs it.
  const upstream = new CachingMarketDataProvider(
    new PersistedPriceProvider(new PriceStore(db), createMarketDataProvider(env, providerHealth)),
  );
  const provider = new CustomRoutingProvider(db, new ManualPriceProvider(db), upstream);
  const isinResolver = new IsinResolver(env.EODHD_API_TOKEN);
  // FX: ECB euro reference rates, the single source. Free, keyless and
  // unrationed, with daily history back to 1999 — which is what lets the
  // portfolio series convert each date at its own rate instead of today's.
  // Rates live in fx_rate_daily; an empty table is seeded here so the first
  // render already has spot rates.
  const ecbFeed = new EcbFxFeed();
  // The service carries the feed so every FX read also nudges a refresh —
  // otherwise rates would load once at boot and never move again.
  const fxRateService = new EcbFxRateService(db, ecbFeed);
  // Awaited so first paint has spot rates when it can, but NEVER fatal: a box
  // with no outbound network (common on a self-hoster's first boot) must still
  // serve. Without rates the views degrade to `fxIncomplete` and the next
  // request retries, which is strictly better than refusing to start.
  await ensureRatesAvailable(db, ecbFeed).catch((err: unknown) => {
    console.error("[fx] could not load ECB rates at startup; serving without FX:", err);
  });
  // Dividend provider fallback chain: primary → EODHD (if key) → Yahoo
  const dividendProviders: IMarketDataProvider[] = [provider];
  if (env.MARKET_DATA_PROVIDER !== "eodhd" && env.EODHD_API_TOKEN) {
    dividendProviders.push(
      new HealthTrackingProvider(
        "eodhd",
        new EodhdProvider({ apiToken: env.EODHD_API_TOKEN }),
        providerHealth,
      ),
    );
  }
  if (env.MARKET_DATA_PROVIDER !== "yahoo") {
    dividendProviders.push(
      new HealthTrackingProvider("yahoo", new YahooFinanceProvider(), providerHealth),
    );
  }

  // News/analyst-ratings: a direct Yahoo handle, bypassing the
  // IMarketDataProvider wrapper chain (which doesn't expose these
  // capabilities). Yahoo-only for now regardless of MARKET_DATA_PROVIDER.
  const intelProvider = new YahooFinanceProvider();

  serve({
    fetch: createApp(
      db,
      provider,
      auth,
      isinResolver,
      fxRateService,
      dividendProviders,
      {
        allowSignup: env.ALLOW_SIGNUP,
        // Sanitised HERE, at the composition root: the route is given booleans
        // for key presence, never the key values, so the System card cannot
        // leak a secret even if someone later widens what it renders.
        systemInfo: {
          nodeEnv: env.NODE_ENV,
          signupsOpen: env.ALLOW_SIGNUP,
          marketData: env.MARKET_DATA_PROVIDER,
          enrichment: env.ENRICHMENT_PROVIDER,
          keys: { eodhd: Boolean(env.EODHD_API_TOKEN) },
        },
        providerHealth,
      },
      intelProvider,
    ).fetch,
    port: env.PORT,
  });
  const enrichLabel = env.ENRICHMENT_PROVIDER !== "none" ? ` +${env.ENRICHMENT_PROVIDER}` : "";
  const signupLabel = env.ALLOW_SIGNUP ? "signup=open" : "signup=closed";
  console.log(
    `api listening on http://localhost:${env.PORT} [${env.MARKET_DATA_PROVIDER}${enrichLabel}; ${signupLabel}]`,
  );
}

main().catch((err) => {
  console.error("Failed to start api:", err);
  process.exit(1);
});
