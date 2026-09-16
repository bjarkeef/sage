import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { AppEnv } from "../middleware/session";
import {
  Decimal,
  Money,
  computePositions,
  OversellError,
  type PositionTransaction,
} from "@sage/core";
import type { IMarketDataProvider } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { instrument, portfolio, transaction } from "../db/schema";
import { getUserPortfolio } from "../auth";
import { syncDividends } from "../market-data/dividend-sync";
import { invalidateReconciliation } from "../services/dividend-reconciliation";
import { toPositionTransaction } from "../lib/to-position-transaction";
import { ensureInstrument } from "../lib/ensure-instrument";
import { backfillProfiles } from "../market-data/asset-profile-cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/** Cursor for desc (tradeDate, createdAt, id) pagination. */
function encodeCursor(row: { tradeDate: string; createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({
      d: row.tradeDate,
      t: row.createdAt.toISOString(),
      i: row.id,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(raw: string): { tradeDate: string; createdAt: Date; id: string } | null {
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      d?: string;
      t?: string;
      i?: string;
    };
    if (!o.d || !o.t || !o.i) return null;
    const createdAt = new Date(o.t);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { tradeDate: o.d, createdAt, id: o.i };
  } catch {
    return null;
  }
}

const transactionType = z.enum(["buy", "sell", "dividend", "split"]);

const createSchema = z
  .object({
    instrument: z.object({
      symbol: z.string().min(1),
      name: z.string().min(1),
      exchange: z.string().min(1),
      currency: z.string().length(3),
      assetType: z.enum(["stock", "etf", "fund", "index", "other"]),
    }),
    type: transactionType,
    quantity: z.string(),
    price: z.string(),
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "tradeDate must be YYYY-MM-DD"),
    fee: z.string().nullish(),
    feeCurrency: z.string().nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "split") {
      if (data.price !== "0") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["price"],
          message: "Price must be '0' for splits",
        });
      }
      try {
        const d = new Decimal(data.quantity);
        if (!d.isFinite() || !d.greaterThan(0)) throw new Error();
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: "Split ratio must be a positive decimal",
        });
      }
    } else {
      try {
        const q = new Decimal(data.quantity);
        if (!q.isFinite() || !q.greaterThan(0)) throw new Error();
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: "quantity must be a positive decimal",
        });
      }
      try {
        const p = new Decimal(data.price);
        if (!p.isFinite() || !p.greaterThan(0)) throw new Error();
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["price"],
          message: "price must be a positive decimal",
        });
      }
    }
  });

const updateSchema = z
  .object({
    type: transactionType,
    quantity: z.string(),
    price: z.string(),
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "tradeDate must be YYYY-MM-DD"),
    fee: z.string().nullish(),
    feeCurrency: z.string().nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "split") {
      if (data.price !== "0") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["price"],
          message: "Price must be '0' for splits",
        });
      }
      try {
        const d = new Decimal(data.quantity);
        if (!d.isFinite() || !d.greaterThan(0)) throw new Error();
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: "Split ratio must be a positive decimal",
        });
      }
    } else {
      try {
        const q = new Decimal(data.quantity);
        if (!q.isFinite() || !q.greaterThan(0)) throw new Error();
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: "quantity must be a positive decimal",
        });
      }
      try {
        const p = new Decimal(data.price);
        if (!p.isFinite() || !p.greaterThan(0)) throw new Error();
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["price"],
          message: "price must be a positive decimal",
        });
      }
    }
  });

function oversellResponse(err: OversellError) {
  return { error: "oversell" as const, symbol: err.symbol };
}

/** Assert the resulting ledger for a symbol is FIFO-valid. */
function assertSymbolLedger(replay: PositionTransaction[]) {
  try {
    computePositions(replay);
  } catch (err) {
    if (err instanceof OversellError) throw err;
    throw err;
  }
}

export function transactionsRoutes(db: Database, provider?: IMarketDataProvider) {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
    }
    const body = parsed.data;
    const ccy = body.instrument.currency;
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);

    await ensureInstrument(db, {
      symbol: body.instrument.symbol,
      name: body.instrument.name,
      exchange: body.instrument.exchange,
      currency: ccy,
      assetType: body.instrument.assetType,
    });

    // Serialize oversell check + insert on the portfolio row so concurrent
    // sells cannot both pass FIFO and both commit (multi-tab / hosted).
    let row: typeof transaction.$inferSelect;
    try {
      row = await db.transaction(async (tx) => {
        await tx
          .select({ id: portfolio.id })
          .from(portfolio)
          .where(eq(portfolio.id, portfolioId))
          .for("update");

        // Only buys and sells have to agree on a currency: FIFO cost basis
        // sums lots, and Money refuses to add across currencies. Dividends and
        // splits are aggregated elsewhere and legitimately settle in the payout
        // currency — a US stock held through a European broker is bought in EUR
        // and pays in USD, and imported ledgers are full of that shape.
        //
        // The ORDER BY is load-bearing, not tidiness: `limit(1)` alone returned
        // whatever row the heap scan reached first, so on a symbol with mixed
        // currencies the verdict depended on physical row order and could flip
        // after an UPDATE or VACUUM with no code change.
        const [existingCcy] =
          body.type === "buy" || body.type === "sell"
            ? await tx
                .select({ currency: transaction.currency })
                .from(transaction)
                .where(
                  and(
                    eq(transaction.portfolioId, portfolioId),
                    eq(transaction.instrumentSymbol, body.instrument.symbol),
                    inArray(transaction.type, ["buy", "sell"]),
                  ),
                )
                .orderBy(transaction.tradeDate, transaction.id)
                .limit(1)
            : [];
        if (existingCcy && existingCcy.currency !== ccy) {
          throw Object.assign(new Error("currency_mismatch"), {
            code: "currency_mismatch" as const,
            expected: existingCcy.currency,
            got: ccy,
          });
        }

        if (body.type === "buy" || body.type === "sell") {
          const existing = await tx
            .select()
            .from(transaction)
            .where(
              and(
                eq(transaction.portfolioId, portfolioId),
                eq(transaction.instrumentSymbol, body.instrument.symbol),
              ),
            );
          const replay: PositionTransaction[] = [
            ...existing.map((r) => toPositionTransaction(r)),
            {
              symbol: body.instrument.symbol,
              type: body.type,
              quantity: new Decimal(body.quantity),
              price: Money.of(body.price, ccy),
              tradeDate: new Date(`${body.tradeDate}T00:00:00Z`),
              sequence: `${new Date().toISOString()}|new`,
            },
          ];
          assertSymbolLedger(replay);
        }

        const [inserted] = await tx
          .insert(transaction)
          .values({
            portfolioId,
            instrumentSymbol: body.instrument.symbol,
            type: body.type,
            quantity: body.quantity,
            price: body.price,
            currency: ccy,
            fee: body.fee ?? null,
            feeCurrency: body.feeCurrency ?? null,
            tradeDate: body.tradeDate,
          })
          .returning();
        return inserted!;
      });
    } catch (err) {
      if (err instanceof OversellError) {
        return c.json(oversellResponse(err), 400);
      }
      if (err && typeof err === "object" && "code" in err && err.code === "currency_mismatch") {
        const e = err as unknown as { expected: string; got: string };
        return c.json(
          {
            error: "currency_mismatch",
            symbol: body.instrument.symbol,
            expected: e.expected,
            got: e.got,
          },
          400,
        );
      }
      throw err;
    }

    if (provider && body.type === "buy") {
      // Then release the reconciliation claim, or the history just fetched is
      // not turned into received dividends for up to a day — see
      // `invalidateReconciliation`.
      syncDividends(db, [provider], body.instrument.symbol)
        .catch((err) => {
          console.warn(
            `dividend sync failed for ${body.instrument.symbol}:`,
            err instanceof Error ? err.message : err,
          );
        })
        .then(() => invalidateReconciliation(db, portfolioId))
        .catch((err: unknown) => {
          console.warn("reconciliation reset failed:", err instanceof Error ? err.message : err);
        });

      // Same reasoning as the import path: sector and country come from
      // `asset_profile`, and nothing wrote that table until someone opened the
      // asset page, so Diversification read `Unknown` for a holding that had
      // just been added. Fire-and-forget; `getCachedOrFetchProfile` no-ops when
      // a fresh entry already exists.
      backfillProfiles(db, provider, [body.instrument.symbol]).catch((err: unknown) => {
        console.warn(
          `profile backfill failed for ${body.instrument.symbol}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }

    return c.json(row, 201);
  });

  app.get("/", async (c) => {
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const limitRaw = c.req.query("limit");
    const limit = Math.min(Math.max(1, Number(limitRaw ?? DEFAULT_PAGE) || DEFAULT_PAGE), MAX_PAGE);
    const cursorRaw = c.req.query("cursor");
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) {
      return c.json({ error: "invalid_cursor" }, 400);
    }

    const conditions = [eq(transaction.portfolioId, portfolioId)];
    // Optional single-holding view (the asset page's ledger section). Absent
    // means the whole portfolio; present-but-unknown correctly yields nothing
    // rather than falling back to everything.
    const symbol = c.req.query("symbol");
    if (symbol) conditions.push(eq(transaction.instrumentSymbol, symbol));
    if (cursor) {
      // Desc (tradeDate, createdAt, id): next page is strictly "older".
      conditions.push(
        or(
          lt(transaction.tradeDate, cursor.tradeDate),
          and(
            eq(transaction.tradeDate, cursor.tradeDate),
            lt(transaction.createdAt, cursor.createdAt),
          ),
          and(
            eq(transaction.tradeDate, cursor.tradeDate),
            eq(transaction.createdAt, cursor.createdAt),
            lt(transaction.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await db
      .select({
        id: transaction.id,
        instrumentSymbol: transaction.instrumentSymbol,
        name: instrument.name,
        type: transaction.type,
        quantity: transaction.quantity,
        price: transaction.price,
        currency: transaction.currency,
        fee: transaction.fee,
        feeCurrency: transaction.feeCurrency,
        tradeDate: transaction.tradeDate,
        source: transaction.source,
        createdAt: transaction.createdAt,
      })
      .from(transaction)
      .innerJoin(instrument, eq(instrument.symbol, transaction.instrumentSymbol))
      .where(and(...conditions))
      .orderBy(desc(transaction.tradeDate), desc(transaction.createdAt), desc(transaction.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit
        ? encodeCursor({
            tradeDate: page[page.length - 1]!.tradeDate,
            createdAt: page[page.length - 1]!.createdAt,
            id: page[page.length - 1]!.id,
          })
        : null;

    // Strip internal createdAt from the public DTO (cursor already used it).
    const items = page.map((row) => {
      const { createdAt, ...rest } = row;
      void createdAt;
      return rest;
    });
    return c.json({ items, nextCursor });
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.body(null, 404);

    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
    }
    const body = parsed.data;
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);

    const [existing] = await db
      .select()
      .from(transaction)
      .where(and(eq(transaction.id, id), eq(transaction.portfolioId, portfolioId)));
    if (!existing) return c.body(null, 404);

    // Always re-validate the whole symbol history with the edited row substituted
    // (including type changes away from buy/sell — those can expose oversells).
    const symbolTxs = await db
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.portfolioId, portfolioId),
          eq(transaction.instrumentSymbol, existing.instrumentSymbol),
        ),
      );
    const replay: PositionTransaction[] = symbolTxs.map((row) =>
      row.id === id
        ? {
            symbol: existing.instrumentSymbol,
            type: body.type,
            quantity: new Decimal(body.quantity),
            price: Money.of(body.price, existing.currency),
            tradeDate: new Date(`${body.tradeDate}T00:00:00Z`),
            sequence: toPositionTransaction(row).sequence,
          }
        : toPositionTransaction(row),
    );
    try {
      assertSymbolLedger(replay);
    } catch (err) {
      if (err instanceof OversellError) {
        return c.json(oversellResponse(err), 400);
      }
      throw err;
    }

    const [updated] = await db
      .update(transaction)
      .set({
        type: body.type,
        quantity: body.quantity,
        price: body.price,
        tradeDate: body.tradeDate,
        fee: body.fee ?? null,
        feeCurrency: body.feeCurrency ?? null,
      })
      .where(and(eq(transaction.id, id), eq(transaction.portfolioId, portfolioId)))
      .returning();
    return c.json(updated);
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.body(null, 404);
    }
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const [existing] = await db
      .select()
      .from(transaction)
      .where(and(eq(transaction.id, id), eq(transaction.portfolioId, portfolioId)));
    if (!existing) return c.body(null, 404);

    // Reject deletes that would leave the remaining ledger oversold.
    const symbolTxs = await db
      .select()
      .from(transaction)
      .where(
        and(
          eq(transaction.portfolioId, portfolioId),
          eq(transaction.instrumentSymbol, existing.instrumentSymbol),
        ),
      );
    const remaining = symbolTxs.filter((row) => row.id !== id).map((r) => toPositionTransaction(r));
    try {
      assertSymbolLedger(remaining);
    } catch (err) {
      if (err instanceof OversellError) {
        return c.json(oversellResponse(err), 400);
      }
      throw err;
    }

    const deleted = await db
      .delete(transaction)
      .where(and(eq(transaction.id, id), eq(transaction.portfolioId, portfolioId)))
      .returning({ id: transaction.id });
    if (deleted.length === 0) return c.body(null, 404);
    return c.body(null, 204);
  });

  return app;
}
