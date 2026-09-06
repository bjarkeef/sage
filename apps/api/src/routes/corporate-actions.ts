import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import type { IFxRateService } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { loadCorporateActions } from "../services/corporate-actions-view";

export function corporateActionsRoutes(db: Database, fxRateService?: IFxRateService) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const userId = c.get("user").id;
    const result = await loadCorporateActions({ db, fxRateService }, userId);
    return c.json(result);
  });

  return app;
}
