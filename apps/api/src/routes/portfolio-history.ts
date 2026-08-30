import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import type { IMarketDataProvider, IFxRateService } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { buildPortfolioHistoryView } from "../services/portfolio-history-view";

export function portfolioHistoryRoutes(
  db: Database,
  provider: IMarketDataProvider,
  fxRateService?: IFxRateService,
) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const benchmarksParam = c.req.query("benchmarks");
    const benchmarks = benchmarksParam
      ? benchmarksParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const result = await buildPortfolioHistoryView(
      { db, provider, fxRateService },
      c.get("user").id,
      {
        range: c.req.query("range"),
        currency: c.req.query("currency"),
        benchmarks,
      },
    );
    return c.json(result);
  });

  return app;
}
