import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../middleware/session";
import type { IMarketDataProvider, IFxRateService } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { transaction } from "../db/schema";
import { getUserPortfolio } from "../auth";
import { buildPortfolioView } from "../services/portfolio-view";
import { reconcileDividends } from "../services/dividend-reconciliation";
import { syncCustomIncome } from "../services/custom-income-sync";

export function portfolioRoutes(
  db: Database,
  provider: IMarketDataProvider,
  fxRateService?: IFxRateService,
) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const userId = c.get("user").id;

    try {
      await syncCustomIncome(db, userId);
    } catch (err) {
      console.warn("custom income sync failed:", err instanceof Error ? err.message : err);
    }

    // Lazy dividend auto-reconciliation — ≤ once/24h; must never break a read.
    try {
      await reconcileDividends(db, userId);
    } catch (err) {
      console.warn("dividend reconciliation failed", err);
    }

    const { body } = await buildPortfolioView({ db, provider, fxRateService }, userId, {
      currency: c.req.query("currency") ?? null,
    });
    return c.json(body);
  });

  app.delete("/all", async (c) => {
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    await db.delete(transaction).where(eq(transaction.portfolioId, portfolioId));
    return c.body(null, 204);
  });

  app.delete("/positions/:symbol", async (c) => {
    const symbol = c.req.param("symbol");
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const deleted = await db
      .delete(transaction)
      .where(
        and(eq(transaction.portfolioId, portfolioId), eq(transaction.instrumentSymbol, symbol)),
      )
      .returning({ id: transaction.id });
    if (deleted.length === 0) return c.body(null, 404);
    return c.body(null, 204);
  });

  return app;
}
