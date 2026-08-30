import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../middleware/session";
import type { Database } from "../db/client";
import { user, portfolio, type OverviewPrefs } from "../db/schema";
import { getUserPortfolio } from "../auth";

// Re-exported so downstream consumers of the /user-settings contract (the
// frontpage and settings page) can import the type and its defaults from
// this route module rather than reaching into the db schema layer.
export type { OverviewPrefs };

export const DEFAULT_OVERVIEW_PREFS: OverviewPrefs = {
  brief: true,
  paydayGreeting: true,
  marketState: true,
  incomeRoom: true,
  portfolioRoom: true,
  statStrip: false,
  performanceCard: true,
  incomeCard: true,
  portfolioCard: true,
  upcomingCard: true,
};

const overviewPrefsSchema = z
  .object({
    brief: z.boolean(),
    paydayGreeting: z.boolean(),
    marketState: z.boolean(),
    incomeRoom: z.boolean(),
    portfolioRoom: z.boolean(),
    statStrip: z.boolean(),
    performanceCard: z.boolean(),
    incomeCard: z.boolean(),
    portfolioCard: z.boolean(),
    upcomingCard: z.boolean(),
  })
  .partial()
  .strict();

const updateSchema = z
  .object({
    displayCurrency: z.string().length(3).nullable(),
    overviewPrefs: overviewPrefsSchema,
    dividendTaxRate: z.number().min(0).max(100).nullable(),
    autoAddDividends: z.boolean(),
    allowNegativeDividendGrowth: z.boolean(),
  })
  .partial();

/** numeric(5,2) columns round-trip through postgres.js as strings. */
function toNullableNumber(v: string | null | undefined): number | null {
  return v == null ? null : Number(v);
}

export function fillDefaults(stored: Partial<OverviewPrefs> | null | undefined): OverviewPrefs {
  const s = stored ?? {};
  const merged = { ...DEFAULT_OVERVIEW_PREFS, ...s };
  // Seed the card keys from the legacy room keys for users whose stored prefs
  // predate the redesign — only when the new key wasn't explicitly stored.
  merged.incomeCard = s.incomeCard ?? s.incomeRoom ?? DEFAULT_OVERVIEW_PREFS.incomeCard;
  merged.portfolioCard = s.portfolioCard ?? s.portfolioRoom ?? DEFAULT_OVERVIEW_PREFS.portfolioCard;
  return merged;
}

export function userSettingsRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const userId = c.get("user").id;
    const [row] = await db
      .select({
        displayCurrency: user.displayCurrency,
        overviewPrefs: user.overviewPrefs,
        dividendTaxRate: user.dividendTaxRate,
        allowNegativeDividendGrowth: user.allowNegativeDividendGrowth,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    const { id: portfolioId } = await getUserPortfolio(db, userId);
    const [pf] = await db
      .select({ autoAddDividends: portfolio.autoAddDividends })
      .from(portfolio)
      .where(eq(portfolio.id, portfolioId));

    return c.json({
      displayCurrency: row?.displayCurrency ?? null,
      overviewPrefs: fillDefaults(row?.overviewPrefs),
      dividendTaxRate: toNullableNumber(row?.dividendTaxRate),
      autoAddDividends: pf?.autoAddDividends ?? true,
      allowNegativeDividendGrowth: row?.allowNegativeDividendGrowth ?? true,
    });
  });

  app.patch("/", async (c) => {
    const userId = c.get("user").id;
    let body: z.infer<typeof updateSchema>;
    try {
      body = updateSchema.parse(await c.req.json());
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const [existing] = await db
      .select({
        displayCurrency: user.displayCurrency,
        overviewPrefs: user.overviewPrefs,
        dividendTaxRate: user.dividendTaxRate,
        allowNegativeDividendGrowth: user.allowNegativeDividendGrowth,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    const mergedPrefs: Partial<OverviewPrefs> | null | undefined = body.overviewPrefs
      ? { ...(existing?.overviewPrefs ?? {}), ...body.overviewPrefs }
      : existing?.overviewPrefs;

    const displayCurrency =
      body.displayCurrency !== undefined
        ? body.displayCurrency
        : (existing?.displayCurrency ?? null);

    const dividendTaxRate =
      body.dividendTaxRate !== undefined
        ? body.dividendTaxRate
        : toNullableNumber(existing?.dividendTaxRate);

    const allowNegativeDividendGrowth =
      body.allowNegativeDividendGrowth !== undefined
        ? body.allowNegativeDividendGrowth
        : (existing?.allowNegativeDividendGrowth ?? true);

    await db
      .update(user)
      .set({
        displayCurrency,
        overviewPrefs: mergedPrefs ?? null,
        dividendTaxRate: dividendTaxRate == null ? null : dividendTaxRate.toFixed(2),
        allowNegativeDividendGrowth,
      })
      .where(eq(user.id, userId));

    const { id: portfolioId } = await getUserPortfolio(db, userId);
    let autoAddDividends: boolean;
    if (body.autoAddDividends !== undefined) {
      await db
        .update(portfolio)
        .set({
          autoAddDividends: body.autoAddDividends,
          // Turning it ON forces a fresh run on the next dividend-relevant read.
          ...(body.autoAddDividends ? { lastReconciledAt: null } : {}),
        })
        .where(eq(portfolio.id, portfolioId));
      autoAddDividends = body.autoAddDividends;
    } else {
      const [pf] = await db
        .select({ autoAddDividends: portfolio.autoAddDividends })
        .from(portfolio)
        .where(eq(portfolio.id, portfolioId));
      autoAddDividends = pf?.autoAddDividends ?? true;
    }

    return c.json({
      displayCurrency,
      overviewPrefs: fillDefaults(mergedPrefs),
      dividendTaxRate,
      autoAddDividends,
      allowNegativeDividendGrowth,
    });
  });

  return app;
}
