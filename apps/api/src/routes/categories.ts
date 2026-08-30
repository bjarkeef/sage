import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import type { IMarketDataProvider, IFxRateService } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { eq } from "drizzle-orm";
import { Decimal, Money, computePositions, type PositionTransaction } from "@sage/core";
import { transaction } from "../db/schema";
import { getUserPortfolio } from "../auth";
import {
  buildCategoriesView,
  replaceCategories,
  CategoriesValidationError,
  CategoryNotFoundError,
  type SaveCategoriesInput,
} from "../services/categories-view";

/** Shape check for one category and, recursively, its children. Depth is not
 *  bounded here: `JSON.parse` has already materialised whatever arrived, so a
 *  limit at this point would reject a payload the process has paid for rather
 *  than protect it from one. */
function isCategoryShape(cat: unknown): boolean {
  if (typeof cat !== "object" || cat === null || Array.isArray(cat)) return false;
  const c = cat as Record<string, unknown>;
  if (typeof c.name !== "string") return false;
  if (c.id !== undefined && typeof c.id !== "string") return false;
  if (c.targetPct !== undefined && c.targetPct !== null && typeof c.targetPct !== "number") {
    return false;
  }
  if (!Array.isArray(c.holdings)) return false;
  for (const h of c.holdings) {
    if (typeof h !== "object" || h === null) return false;
    const holding = h as Record<string, unknown>;
    if (typeof holding.symbol !== "string") return false;
    if (
      holding.targetPct !== undefined &&
      holding.targetPct !== null &&
      typeof holding.targetPct !== "number"
    ) {
      return false;
    }
  }
  if (c.children !== undefined) {
    if (!Array.isArray(c.children)) return false;
    if (!c.children.every(isCategoryShape)) return false;
  }
  return true;
}

export function categoriesRoutes(
  db: Database,
  provider: IMarketDataProvider,
  fxRateService?: IFxRateService,
) {
  const app = new Hono<AppEnv>();

  app.get("/view", async (c) => {
    const userId = c.get("user").id;
    const body = await buildCategoriesView({ db, provider, fxRateService }, userId, {
      currency: c.req.query("currency"),
    });
    return c.json(body);
  });

  app.put("/", async (c) => {
    const userId = c.get("user").id;
    const body = (await c.req.json().catch(() => null)) as SaveCategoriesInput | null;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !Array.isArray(body.categories) ||
      !Array.isArray(body.rootHoldings) ||
      !body.categories.every(isCategoryShape) ||
      body.rootHoldings.some(
        (t) => typeof t?.symbol !== "string" || typeof t?.targetPct !== "number",
      )
    ) {
      return c.json({ error: "invalid payload" }, 400);
    }

    const { id: portfolioId } = await getUserPortfolio(db, userId);
    const rows = await db
      .select()
      .from(transaction)
      .where(eq(transaction.portfolioId, portfolioId));
    const txs: PositionTransaction[] = rows.map((row) => ({
      symbol: row.instrumentSymbol,
      type: row.type as PositionTransaction["type"],
      quantity: new Decimal(row.quantity),
      price: Money.of(row.price, row.currency),
      tradeDate: new Date(`${row.tradeDate}T00:00:00Z`),
    }));
    const heldSymbols = new Set(computePositions(txs).map((p) => p.symbol));

    try {
      await replaceCategories(db, portfolioId, heldSymbols, body);
    } catch (err) {
      if (err instanceof CategoriesValidationError) return c.json({ error: err.message }, 400);
      if (err instanceof CategoryNotFoundError) return c.json({ error: "category not found" }, 404);
      throw err;
    }

    const view = await buildCategoriesView({ db, provider, fxRateService }, userId, {
      currency: c.req.query("currency"),
    });
    return c.json(view);
  });

  return app;
}
