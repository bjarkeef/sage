import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../middleware/session";
import type { Database } from "../db/client";
import { assetProfile, customHolding, instrument, manualPrice } from "../db/schema";
import { getUserPortfolio } from "../auth";

const incomeSchema = z.object({
  yearlyPct: z.string().regex(/^\d+(\.\d+)?$/),
  frequencyUnit: z.enum(["week", "month", "quarter", "year"]),
  frequencyInterval: z.number().int().min(1).default(1),
  firstPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastPaymentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  reinvest: z.boolean(),
  autoAdd: z.boolean().default(true),
});

const createSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Z0-9_.-]+$/i, "letters, digits, _ . - only"),
  name: z.string().min(1),
  currency: z.string().length(3),
  holdingType: z.enum(["savings", "pension", "other"]),
  sector: z.string().nullish(),
  country: z.string().nullish(),
  note: z.string().nullish(),
  initialPrice: z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), price: z.string() })
    .nullish(),
  income: incomeSchema.nullish(),
});

const updateSchema = createSchema.omit({ symbol: true, currency: true, initialPrice: true });

function incomeColumns(income: z.infer<typeof incomeSchema> | null | undefined) {
  return income
    ? {
        incomeEnabled: true,
        incomeYearlyPct: income.yearlyPct,
        frequencyUnit: income.frequencyUnit,
        frequencyInterval: income.frequencyInterval,
        firstPaymentDate: income.firstPaymentDate,
        lastPaymentDate: income.lastPaymentDate ?? null,
        autoAdd: income.autoAdd,
        reinvest: income.reinvest,
      }
    : {
        incomeEnabled: false,
        incomeYearlyPct: null,
        frequencyUnit: null,
        frequencyInterval: 1,
        firstPaymentDate: null,
        lastPaymentDate: null,
        autoAdd: true,
        reinvest: false,
      };
}

export function customHoldingsRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const parsed = createSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);

    const symbol = body.symbol.toUpperCase();
    const existing = await db
      .select({ s: instrument.symbol })
      .from(instrument)
      .where(eq(instrument.symbol, symbol))
      .limit(1);
    if (existing.length > 0) return c.json({ error: "symbol_exists" }, 409);

    const currency = body.currency.toUpperCase();
    // Atomic multi-write: partial create leaves orphan instruments that block
    // retry with symbol_exists (409) and no holding row.
    await db.transaction(async (tx) => {
      await tx.insert(instrument).values({
        symbol,
        name: body.name,
        exchange: "CUSTOM",
        currency,
        assetType: "custom",
      });
      await tx.insert(customHolding).values({
        symbol,
        portfolioId,
        holdingType: body.holdingType,
        sector: body.sector ?? null,
        country: body.country ?? null,
        note: body.note ?? null,
        ...incomeColumns(body.income),
      });
      if (body.initialPrice) {
        await tx.insert(manualPrice).values({
          symbol,
          date: body.initialPrice.date,
          price: body.initialPrice.price,
          currency,
        });
      }

      // Mirror into asset_profile so sector-based views that read the cache
      // table directly (e.g. diversification) see this data immediately,
      // instead of waiting for an asset-page visit to warm the provider cache.
      await tx
        .insert(assetProfile)
        .values({
          symbol,
          name: body.name,
          exchange: "CUSTOM",
          assetType: "other",
          currency,
          sector: body.sector ?? null,
          country: body.country ?? null,
        })
        .onConflictDoUpdate({
          target: assetProfile.symbol,
          set: { name: body.name, sector: body.sector ?? null, country: body.country ?? null },
        });
    });

    return c.json({ symbol }, 201);
  });

  app.get("/:symbol", async (c) => {
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const symbol = c.req.param("symbol");
    const [row] = await db
      .select()
      .from(customHolding)
      .where(and(eq(customHolding.symbol, symbol), eq(customHolding.portfolioId, portfolioId)))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    const [inst] = await db.select().from(instrument).where(eq(instrument.symbol, symbol)).limit(1);
    const marks = await db
      .select({ date: manualPrice.date, price: manualPrice.price })
      .from(manualPrice)
      .where(eq(manualPrice.symbol, symbol));
    return c.json({
      symbol,
      name: inst?.name ?? symbol,
      currency: inst?.currency ?? "",
      holdingType: row.holdingType,
      sector: row.sector,
      country: row.country,
      note: row.note,
      incomeEnabled: row.incomeEnabled,
      income: row.incomeEnabled
        ? {
            yearlyPct: row.incomeYearlyPct,
            frequencyUnit: row.frequencyUnit,
            frequencyInterval: row.frequencyInterval,
            firstPaymentDate: row.firstPaymentDate,
            lastPaymentDate: row.lastPaymentDate,
            reinvest: row.reinvest,
            autoAdd: row.autoAdd,
          }
        : null,
      priceMarks: marks.sort((a, b) => (a.date < b.date ? -1 : 1)),
    });
  });

  app.put("/:symbol", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const symbol = c.req.param("symbol");
    const updated = await db
      .update(customHolding)
      .set({
        holdingType: body.holdingType,
        sector: body.sector ?? null,
        country: body.country ?? null,
        note: body.note ?? null,
        ...incomeColumns(body.income),
      })
      .where(and(eq(customHolding.symbol, symbol), eq(customHolding.portfolioId, portfolioId)))
      .returning({ symbol: customHolding.symbol });
    if (updated.length === 0) return c.json({ error: "not_found" }, 404);
    await db.update(instrument).set({ name: body.name }).where(eq(instrument.symbol, symbol));

    // Same asset_profile mirroring as create — body has no currency, so pull
    // it from the instrument row that must already exist for this symbol.
    const [inst] = await db
      .select({ currency: instrument.currency })
      .from(instrument)
      .where(eq(instrument.symbol, symbol))
      .limit(1);
    await db
      .insert(assetProfile)
      .values({
        symbol,
        name: body.name,
        exchange: "CUSTOM",
        assetType: "other",
        currency: inst!.currency,
        sector: body.sector ?? null,
        country: body.country ?? null,
      })
      .onConflictDoUpdate({
        target: assetProfile.symbol,
        set: { name: body.name, sector: body.sector ?? null, country: body.country ?? null },
      });

    return c.json({ ok: true });
  });

  app.post("/:symbol/prices", async (c) => {
    const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), price: z.string() });
    const parsed = schema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const symbol = c.req.param("symbol");
    const [owned] = await db
      .select({ s: customHolding.symbol })
      .from(customHolding)
      .where(and(eq(customHolding.symbol, symbol), eq(customHolding.portfolioId, portfolioId)))
      .limit(1);
    if (!owned) return c.json({ error: "not_found" }, 404);
    const [inst] = await db
      .select({ currency: instrument.currency })
      .from(instrument)
      .where(eq(instrument.symbol, symbol))
      .limit(1);
    await db
      .insert(manualPrice)
      .values({
        symbol,
        date: parsed.data.date,
        price: parsed.data.price,
        currency: inst!.currency,
      })
      .onConflictDoUpdate({
        target: [manualPrice.symbol, manualPrice.date],
        set: { price: parsed.data.price },
      });
    return c.json({ ok: true });
  });

  app.delete("/:symbol/prices/:date", async (c) => {
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const symbol = c.req.param("symbol");
    const [owned] = await db
      .select({ s: customHolding.symbol })
      .from(customHolding)
      .where(and(eq(customHolding.symbol, symbol), eq(customHolding.portfolioId, portfolioId)))
      .limit(1);
    if (!owned) return c.json({ error: "not_found" }, 404);
    await db
      .delete(manualPrice)
      .where(and(eq(manualPrice.symbol, symbol), eq(manualPrice.date, c.req.param("date"))));
    return c.json({ ok: true });
  });

  return app;
}
