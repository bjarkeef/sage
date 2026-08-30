import { Hono } from "hono";
import type {
  INewsProvider,
  IAnalystRatingsProvider,
  IMarketDataProvider,
  IFxRateService,
} from "@sage/provider-interface";
import type { AppEnv } from "../middleware/session";
import type { Database } from "../db/client";
import { getSymbolNews, getPortfolioNews } from "../services/news-view";
import { resolveAssetSlug } from "./asset-slug";
import { getSymbolRatings } from "../services/ratings-view";

// Slug resolution lives in ./asset-slug so these routes cannot drift from
// /asset's — a dash may belong to the symbol rather than an exchange prefix.

export function intelRoutes(
  db: Database,
  provider: INewsProvider & IAnalystRatingsProvider,
  marketProvider: IMarketDataProvider,
  fxRateService?: IFxRateService,
) {
  const app = new Hono<AppEnv>();

  app.get("/asset/:slug/news", async (c) => {
    const symbol = await resolveAssetSlug(db, decodeURIComponent(c.req.param("slug")));
    return c.json(await getSymbolNews(db, provider, symbol));
  });

  app.get("/asset/:slug/ratings", async (c) => {
    const symbol = await resolveAssetSlug(db, decodeURIComponent(c.req.param("slug")));
    return c.json(await getSymbolRatings(db, provider, symbol));
  });

  app.get("/news", async (c) => {
    const { id } = c.get("user");
    // getPortfolioNews resolves the user's held symbols internally, then ranks
    // the cached feed against their weights and today's moves.
    return c.json(
      await getPortfolioNews({ db, provider: marketProvider, fxRateService }, provider, id),
    );
  });

  return app;
}
