import { Hono } from "hono";
import { eq, desc, inArray } from "drizzle-orm";
import type { AppEnv } from "../middleware/session";
import type { IMarketDataProvider, IFxRateService } from "@sage/provider-interface";
import { Decimal, computePositions, type PositionTransaction, Money } from "@sage/core";
import type { Database } from "../db/client";
import { dividendHistory, transaction, instrument } from "../db/schema";
import { getUserPortfolio } from "../auth";
import { syncAllPositionDividends } from "../market-data/dividend-sync";
import { buildDividendIncomeView } from "../services/dividend-income-view";
import { reconcileDividends } from "../services/dividend-reconciliation";
import { syncCustomIncome } from "../services/custom-income-sync";

export function dividendsRoutes(
  db: Database,
  provider: IMarketDataProvider,
  fxRateService?: IFxRateService,
  dividendProviders?: IMarketDataProvider[],
) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
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

    const positions = computePositions(txs);
    const symbols = positions.map((p) => p.symbol);

    if (symbols.length === 0) {
      return c.json({ dividends: [], positions: [] });
    }

    const instruments = await db.select().from(instrument);
    const nameBySymbol = new Map(instruments.map((i) => [i.symbol, i.name]));

    const dividendRows = await db
      .select()
      .from(dividendHistory)
      .where(inArray(dividendHistory.symbol, symbols))
      .orderBy(desc(dividendHistory.exDate));

    const dividendsDTO = dividendRows.map((d) => ({
      symbol: d.symbol,
      name: nameBySymbol.get(d.symbol) ?? d.symbol,
      exDate: d.exDate,
      amountPerShare: d.amountPerShare,
      currency: d.currency,
      paymentDate: d.paymentDate,
      source: d.source,
    }));

    const positionsDTO = positions.map((p) => ({
      symbol: p.symbol,
      name: nameBySymbol.get(p.symbol) ?? p.symbol,
      currency: p.currency,
      quantity: p.quantity.toFixed(),
      averageCost: p.averageCost.toJSON(),
    }));

    return c.json({ dividends: dividendsDTO, positions: positionsDTO });
  });

  app.post("/sync", async (c) => {
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
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

    const positions = computePositions(txs);
    const symbols = positions.map((p) => p.symbol);

    const results = await syncAllPositionDividends(db, dividendProviders ?? [provider], symbols);
    const synced: Record<string, number> = {};
    for (const [sym, count] of results) {
      synced[sym] = count;
    }

    return c.json({ synced });
  });

  app.get("/income", async (c) => {
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

    const result = await buildDividendIncomeView(
      { db, provider, fxRateService, dividendProviders },
      userId,
      { currency: c.req.query("currency") ?? null },
    );
    return c.json(result);
  });

  return app;
}
