import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { IMarketDataProvider } from "@sage/provider-interface";
import type { AppEnv } from "../middleware/session";
import type { Database } from "../db/client";
import { customHolding } from "../db/schema";
import { getUserPortfolio } from "../auth";

/** Routes for instrument lookup. Backed by the market-data provider's search. */
export function instrumentsRoutes(db: Database, provider: IMarketDataProvider) {
  const app = new Hono<AppEnv>();
  app.get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length === 0) return c.json([]);
    const results = await provider.searchSymbol(q);

    // Multi-tenant: custom symbols are portfolio-private. Market results pass
    // through; CUSTOM exchange rows only if this portfolio owns them.
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const owned = await db
      .select({ symbol: customHolding.symbol })
      .from(customHolding)
      .where(eq(customHolding.portfolioId, portfolioId));
    const ownedSet = new Set(owned.map((r) => r.symbol));
    const filtered = results.filter((r) => r.exchange !== "CUSTOM" || ownedSet.has(r.symbol));
    return c.json(filtered);
  });
  app.get("/:symbol/quote", async (c) => {
    const symbol = c.req.param("symbol");
    try {
      const quote = await provider.getQuote(symbol);
      return c.json({
        price: quote.price.toJSON(),
        asOf: quote.asOf.toISOString().slice(0, 10),
      });
    } catch {
      return c.json({ error: "quote_unavailable" }, 404);
    }
  });
  return app;
}
