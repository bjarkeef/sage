import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { IMarketDataProvider, IFxRateService } from "@sage/provider-interface";
import type { AppEnv } from "../middleware/session";
import type { Database } from "../db/client";
import { goal } from "../db/schema";
import { getUserPortfolio } from "../auth";
import { buildGoalView } from "../services/goal-view";
import { reconcileDividends } from "../services/dividend-reconciliation";
import { syncCustomIncome } from "../services/custom-income-sync";

function putSchema(currentYear: number) {
  return z.object({
    type: z.enum(["passive_income", "value"]),
    amount: z.number().positive(),
    targetYear: z
      .number()
      .int()
      .min(currentYear + 1)
      .max(currentYear + 50),
    monthlyContribution: z.number().min(0).nullable(),
    contributionIncrease: z.enum(["none", "inflation", "custom"]),
    contributionIncreasePct: z.number().min(0).max(50).nullable(),
    divYieldPct: z.number().min(0).max(50).nullable(),
    divGrowthPct: z.number().min(-20).max(50).nullable(),
    annualReturnPct: z.number().min(-50).max(100).nullable(),
    adjustGoalForInflation: z.boolean(),
    inflationPct: z.number().min(0).max(50),
    reinvestDividends: z.boolean(),
    suggestAlternative: z.boolean(),
  });
}

const pct = (v: number | null): string | null => (v == null ? null : v.toFixed(2));

export function goalRoutes(
  db: Database,
  provider: IMarketDataProvider,
  fxRateService?: IFxRateService,
  dividendProviders?: IMarketDataProvider[],
) {
  const app = new Hono<AppEnv>();
  const deps = { db, provider, fxRateService, dividendProviders };

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

    const view = await buildGoalView(deps, userId);
    return c.json(view);
  });

  app.put("/", async (c) => {
    const userId = c.get("user").id;
    let body: z.infer<ReturnType<typeof putSchema>>;
    try {
      body = putSchema(new Date().getFullYear()).parse(await c.req.json());
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    // The goal currency is server-assigned: it must be the computation
    // currency (display currency or the single native currency) — v1 has no
    // goal-only FX. Resolve it via the view (also validates computability).
    const preview = await buildGoalView(deps, userId);
    if (!preview.defaults) {
      return c.json({ error: preview.reason ?? "cannot compute a goal for this portfolio" }, 409);
    }

    const { id: portfolioId } = await getUserPortfolio(db, userId);
    const values = {
      portfolioId,
      type: body.type,
      amount: body.amount.toFixed(2),
      currency: preview.defaults.currency,
      targetYear: body.targetYear,
      monthlyContribution: body.monthlyContribution?.toFixed(2) ?? null,
      contributionIncrease: body.contributionIncrease,
      contributionIncreasePct: pct(body.contributionIncreasePct),
      divYieldPct: pct(body.divYieldPct),
      divGrowthPct: pct(body.divGrowthPct),
      annualReturnPct: pct(body.annualReturnPct),
      adjustGoalForInflation: body.adjustGoalForInflation,
      inflationPct: body.inflationPct.toFixed(2),
      reinvestDividends: body.reinvestDividends,
      suggestAlternative: body.suggestAlternative,
      updatedAt: new Date(),
    };
    await db
      .insert(goal)
      .values(values)
      .onConflictDoUpdate({ target: goal.portfolioId, set: values });

    const view = await buildGoalView(deps, userId);
    return c.json(view);
  });

  app.delete("/", async (c) => {
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    await db.delete(goal).where(eq(goal.portfolioId, portfolioId));
    return c.body(null, 204);
  });

  return app;
}
