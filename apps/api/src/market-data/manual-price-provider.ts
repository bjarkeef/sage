import { and, eq, ilike, or } from "drizzle-orm";
import { Decimal, Money } from "@sage/core";
import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
} from "@sage/provider-interface";
import { SymbolNotFoundError } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { instrument, manualPrice, transaction, customHolding } from "../db/schema";

export interface PricePoint {
  date: string;
  price: Decimal;
  currency: string;
}

/** A custom symbol's known price series: manual marks, plus buy/sell
 *  transaction prices as fallback points (zero-price reinvest credits are
 *  noise, not prices). Marks win when both exist on a date. Ascending. */
export async function resolvePricePoints(db: Database, symbol: string): Promise<PricePoint[]> {
  const marks = await db
    .select({ date: manualPrice.date, price: manualPrice.price, currency: manualPrice.currency })
    .from(manualPrice)
    .where(eq(manualPrice.symbol, symbol));
  const txs = await db
    .select({
      date: transaction.tradeDate,
      price: transaction.price,
      currency: transaction.currency,
      type: transaction.type,
    })
    .from(transaction)
    .where(eq(transaction.instrumentSymbol, symbol));

  const byDate = new Map<string, PricePoint>();
  for (const tx of txs) {
    if (tx.type !== "buy" && tx.type !== "sell") continue;
    const price = new Decimal(tx.price);
    if (price.isZero()) continue;
    byDate.set(tx.date, { date: tx.date, price, currency: tx.currency });
  }
  for (const m of marks) {
    byDate.set(m.date, { date: m.date, price: new Decimal(m.price), currency: m.currency });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Serves custom instruments from local data. Only ever called for custom
 *  symbols (the routing provider guards); throws SymbolNotFoundError when a
 *  symbol has no price data at all. */
export class ManualPriceProvider implements IMarketDataProvider {
  constructor(private readonly db: Database) {}

  async getQuote(symbol: string): Promise<Quote> {
    const points = await resolvePricePoints(this.db, symbol);
    if (points.length === 0) throw new SymbolNotFoundError(symbol);
    const last = points[points.length - 1]!;
    const prev = points.length > 1 ? points[points.length - 2]! : last;
    return {
      symbol,
      price: Money.of(last.price, last.currency),
      asOf: new Date(`${last.date}T00:00:00Z`),
      previousClose: Money.of(prev.price, prev.currency),
    };
  }

  async getHistoricalPrices(symbol: string, from: Date, to: Date): Promise<PriceBar[]> {
    const points = await resolvePricePoints(this.db, symbol);
    const fromKey = from.toISOString().slice(0, 10);
    const toKey = to.toISOString().slice(0, 10);
    const inWindow = points.filter((p) => p.date >= fromKey && p.date <= toKey);
    // Seed: the valuation series forward-fills from bars INSIDE the fetched
    // window; a symbol whose last mark predates the window would otherwise
    // vanish from history charts.
    const before = points.filter((p) => p.date < fromKey).pop();
    if (before && (inWindow.length === 0 || inWindow[0]!.date !== fromKey)) {
      inWindow.unshift({ ...before, date: fromKey });
    }
    return inWindow.map((p) => {
      const money = Money.of(p.price, p.currency);
      return {
        date: new Date(`${p.date}T00:00:00Z`),
        open: money,
        high: money,
        low: money,
        close: money,
        volume: new Decimal(0),
      };
    });
  }

  getDividendHistory(symbol: string): Promise<Dividend[]> {
    void symbol; // interface position only — income lands in dividend_history via the income engine
    return Promise.resolve([]);
  }

  async searchSymbol(query: string): Promise<SearchResult[]> {
    const rows = await this.db
      .select({ symbol: instrument.symbol, name: instrument.name, currency: instrument.currency })
      .from(instrument)
      .where(
        and(
          eq(instrument.assetType, "custom"),
          or(ilike(instrument.symbol, `%${query}%`), ilike(instrument.name, `%${query}%`)),
        ),
      );
    return rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      exchange: "CUSTOM",
      currency: r.currency,
      assetType: "other" as const,
    }));
  }

  async getAssetProfile(symbol: string): Promise<AssetProfile> {
    const [inst] = await this.db
      .select()
      .from(instrument)
      .where(eq(instrument.symbol, symbol))
      .limit(1);
    if (!inst) throw new SymbolNotFoundError(symbol);
    const [settings] = await this.db
      .select({
        sector: customHolding.sector,
        country: customHolding.country,
      })
      .from(customHolding)
      .where(eq(customHolding.symbol, symbol))
      .limit(1);
    return {
      symbol,
      name: inst.name,
      exchange: "CUSTOM",
      currency: inst.currency,
      assetType: "other",
      sector: settings?.sector ?? null,
      industry: null,
      marketCap: null,
      peRatio: null,
      beta: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      dividendYield: null,
      payoutRatio: null,
      trailingAnnualDividend: null,
      website: null,
      // Notes are portfolio-private — serve via GET /custom-holdings/:symbol,
      // never on the shared asset profile (multi-tenant isolation).
      description: null,
      ceo: null,
      fullTimeEmployees: null,
      ipoDate: null,
      country: settings?.country ?? null,
      countryIso: null,
      fund: null,
    };
  }
}
