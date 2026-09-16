import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import type { Database } from "./db/client";
import type {
  IMarketDataProvider,
  IFxRateService,
  INewsProvider,
  IAnalystRatingsProvider,
} from "@sage/provider-interface";
import type { Auth } from "./auth";
import { sessionMiddleware, type AppEnv } from "./middleware/session";
import { user } from "./db/schema";
import { instrumentsRoutes } from "./routes/instruments";
import { transactionsRoutes } from "./routes/transactions";
import { portfolioRoutes } from "./routes/portfolio";
import { portfolioHistoryRoutes } from "./routes/portfolio-history";
import { dividendsRoutes } from "./routes/dividends";
import { assetRoutes } from "./routes/asset";
import { importRoutes } from "./routes/import";
import { diversificationRoutes } from "./routes/diversification";
import { dashboardRoutes } from "./routes/dashboard";
import { performanceRoutes } from "./routes/performance";
import { userSettingsRoutes } from "./routes/user-settings";
import { goalRoutes } from "./routes/goal";
import { customHoldingsRoutes } from "./routes/custom-holdings";
import { categoriesRoutes } from "./routes/categories";
import { systemRoutes, type SystemInfo } from "./routes/system";
import { exportRoutes } from "./routes/export";
import { intelRoutes } from "./routes/intel";
import { corporateActionsRoutes } from "./routes/corporate-actions";
import type { IsinResolver } from "./market-data/isin-resolver";
import type { ProviderHealthRegistry } from "./market-data/provider-health";

export type CreateAppOptions = {
  /** When false, registration is closed (self-host after first user). Default true. */
  allowSignup?: boolean;
  /** Deployment facts for the Settings > System card, pre-sanitised by the
   *  composition root. Never pass `Env` here — it carries the API key values
   *  and this object is serialised to the client. */
  systemInfo?: SystemInfo;
  /** Supplied by the composition root so `GET /system` can report which
   *  upstreams are answering. Omitted in tests that don't care. */
  providerHealth?: ProviderHealthRegistry;
};

/** Build the Hono app. Takes the database, market-data provider, and auth
 *  instance by injection so routes can be tested with stubs without binding
 *  a port. The web app calls these routes from the browser (a different
 *  origin), so CORS is required. */
export function createApp(
  db: Database,
  provider: IMarketDataProvider,
  auth: Auth,
  isinResolver?: IsinResolver,
  fxRateService?: IFxRateService,
  dividendProviders?: IMarketDataProvider[],
  options: CreateAppOptions = {},
  // Direct handle to a news/analyst-ratings capable provider. Separate from
  // `provider` above: the wrapper chain (CustomRoutingProvider -> Caching ->
  // Fallback/Enriching) is IMarketDataProvider-only and does not expose these
  // capabilities, so intel routes need their own provider reference. Optional
  // so existing callers/tests that don't need news/ratings are unaffected;
  // when absent, the intel routes are simply not mounted.
  intelProvider?: INewsProvider & IAnalystRatingsProvider,
) {
  const allowSignup = options.allowSignup ?? true;
  const origins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const app = new Hono<AppEnv>();

  // Every view response is JSON and compresses by roughly 80%: against a real
  // book /dashboard is 52.6 kB raw and 6.8 kB gzipped, /performance?range=1Y
  // 30.8 kB against 5.5 kB, /portfolio 18.7 kB against 3.1 kB. The web app
  // fetches the API cross-origin, so Next's own compression never touches any
  // of it, and a self-hosted Sage has no reverse proxy in front to make up the
  // difference.
  //
  // The middleware's 1 kB `threshold` does NOT apply here, and passing one
  // would not change that: Hono answers with a stream and no Content-Length,
  // which is the only thing the threshold can read. So tiny replies are
  // compressed too, and /health goes out as 35 bytes rather than 15. That is
  // the whole cost, and it buys not having to reason about which routes are
  // small enough to exempt.
  app.use("*", compress());

  // A schema that rejects a query parameter is the caller's mistake. Several
  // routes `parse` their input rather than `safeParse` it, and an uncaught
  // ZodError otherwise reaches Hono's default handler as a 500 — so
  // `/performance?range=6M` read as a server fault. Anything else still is one.
  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json({ error: err.issues.map((i) => i.message).join("; ") }, 400);
    }
    // Everything else keeps Hono's default behaviour exactly.
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.text("Internal Server Error", 500);
  });

  app.use("*", cors({ origin: origins, credentials: true }));

  // Auth handler — must come before session middleware. NOTE: the pattern
  // must be "/api/auth/*" — "**" is not a Hono pattern; it only accidentally
  // matched under the TrieRouter and silently stops matching once mounted
  // sub-apps make the SmartRouter settle on the RegExpRouter, sending every
  // auth request into the 401 session middleware instead.
  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // Health check — public, no auth required
  app.get("/health", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "degraded" }, 503);
    }
  });

  // Public deploy config (no session). Lets the web UI hide sign-up when the
  // instance is locked down (self-host) without duplicating env on the web
  // service. Hosted multi-tenant keeps allowSignup true.
  app.get("/public-config", async (c) => {
    // Whether anyone has claimed this instance yet. The sign-in page sends the
    // very first visitor to /sign-up instead of greeting them with "Welcome
    // back" and a sign-in form for an account that cannot exist.
    //
    // Not a disclosure worth guarding: an unclaimed instance is one whose
    // signup endpoint already accepts anyone, so the flag tells a stranger
    // nothing they could not learn by posting to it.
    // Never let this endpoint fail on the database. It is unauthenticated, it
    // is hit on every page load, and it answered without touching Postgres
    // until this flag arrived. `true` is the safe guess: it only suppresses
    // the redirect to /sign-up, and showing a sign-in form to a first visitor
    // is recoverable where bouncing a returning one is not.
    let hasAccounts = true;
    try {
      const [existing] = await db.select({ id: user.id }).from(user).limit(1);
      hasAccounts = existing !== undefined;
    } catch {
      hasAccounts = true;
    }
    return c.json({
      allowSignup,
      hasAccounts,
      // Deployment posture for docs/ops — not a security boundary.
      mode: allowSignup ? "open" : "invite_only",
    });
  });

  // All routes below require authentication
  app.use("*", sessionMiddleware(auth));
  app.route("/instruments", instrumentsRoutes(db, provider));
  app.route("/transactions", transactionsRoutes(db, provider));
  app.route("/dividends", dividendsRoutes(db, provider, fxRateService, dividendProviders));
  app.route("/portfolio/history", portfolioHistoryRoutes(db, provider, fxRateService));
  app.route("/portfolio/diversification", diversificationRoutes(db, provider, fxRateService));
  app.route("/portfolio", portfolioRoutes(db, provider, fxRateService));
  app.route("/dashboard", dashboardRoutes(db, provider, fxRateService, dividendProviders));
  app.route("/performance", performanceRoutes(db, provider, fxRateService));
  app.route("/asset", assetRoutes(db, provider, isinResolver, fxRateService));
  app.route("/import", importRoutes(db, provider, isinResolver));
  app.route("/user/settings", userSettingsRoutes(db));
  app.route("/goal", goalRoutes(db, provider, fxRateService, dividendProviders));
  app.route("/custom-holdings", customHoldingsRoutes(db));
  app.route("/categories", categoriesRoutes(db, provider, fxRateService));
  app.route("/corporate-actions", corporateActionsRoutes(db, fxRateService));
  app.route("/system", systemRoutes(db, fxRateService, options.systemInfo, options.providerHealth));
  app.route("/export", exportRoutes(db));
  if (intelProvider) {
    app.route("/", intelRoutes(db, intelProvider, provider, fxRateService));
  }

  return app;
}
