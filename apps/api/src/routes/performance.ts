import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import type { IMarketDataProvider, IFxRateService } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { buildPerformanceView } from "../services/performance-view";
import { reconcileDividends } from "../services/dividend-reconciliation";
import { syncCustomIncome } from "../services/custom-income-sync";

export function performanceRoutes(
  db: Database,
  provider: IMarketDataProvider,
  fxRateService?: IFxRateService,
) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    try {
      await syncCustomIncome(db, c.get("user").id);
    } catch (err) {
      console.warn("custom income sync failed:", err instanceof Error ? err.message : err);
    }

    // Lazy dividend auto-reconciliation — ≤ once/24h; must never break a read.
    try {
      await reconcileDividends(db, c.get("user").id);
    } catch (err) {
      console.warn("dividend reconciliation failed", err);
    }

    const benchmarksParam = c.req.query("benchmarks");
    const benchmarks = benchmarksParam
      ? benchmarksParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const result = await buildPerformanceView({ db, provider, fxRateService }, c.get("user").id, {
      range: c.req.query("range"),
      currency: c.req.query("currency"),
      benchmarks,
      // The one caller whose entire purpose is the figure. The dashboard and
      // goal views deliberately do not set this: they report short history
      // without paying to fix it, and a visit here fixes it for them.
      repairHistory: true,
    });
    return c.json(result);
  });

  return app;
}
