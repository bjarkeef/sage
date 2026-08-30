import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import type { IMarketDataProvider } from "@sage/provider-interface";
import type { IFxRateService } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { buildDiversificationView } from "../services/diversification-view";

export function diversificationRoutes(
  db: Database,
  provider: IMarketDataProvider,
  fxRateService?: IFxRateService,
) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const userId = c.get("user").id;
    const result = await buildDiversificationView({ db, provider, fxRateService }, userId, {
      currency: c.req.query("currency"),
    });
    return c.json(result);
  });

  return app;
}
