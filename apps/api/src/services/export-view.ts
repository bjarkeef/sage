import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { getUserPortfolio } from "../auth";
import {
  category,
  categoryAssignment,
  customHolding,
  goal,
  instrument,
  manualPrice,
  portfolio,
  transaction,
  user,
} from "../db/schema";

/** The export format's own version, bumped when the shape changes. Present so a
 *  future restore can tell which shape it is reading. */
export const EXPORT_VERSION = 1;

/** One CSV line. Every field is a string — `""` for absent — so the writer can
 *  never emit the text "null" into a file someone will re-import. */
export interface ExportTransactionRow {
  symbol: string;
  type: string;
  quantity: string;
  price: string;
  currency: string;
  tradeDate: string;
  fee: string;
  feeCurrency: string;
  exchange: string;
  name: string;
  /** "auto" for dividend rows created by reconciliation, "custom-income" for
   *  rows the custom-holding income engine generated (buys from reinvestment,
   *  dividends otherwise), "" for everything the user entered or imported.
   *  Ignored by Sage's own importer. */
  source: string;
}

export interface ExportDocument {
  version: number;
  exportedAt: string;
  portfolio: { name: string; autoAddDividends: boolean };
  user: {
    displayCurrency: string | null;
    dividendTaxRate: string | null;
    overviewPrefs: unknown;
    allowNegativeDividendGrowth: boolean;
  };
  instruments: {
    symbol: string;
    name: string;
    exchange: string;
    currency: string;
    assetType: string;
    isin: string | null;
  }[];
  transactions: {
    id: string;
    symbol: string;
    type: string;
    quantity: string;
    price: string;
    currency: string;
    fee: string | null;
    feeCurrency: string | null;
    source: string | null;
    tradeDate: string;
  }[];
  customHoldings: (typeof customHolding.$inferSelect)[];
  manualPrices: { symbol: string; date: string; price: string; currency: string }[];
  categories: {
    id: string;
    parentId: string | null;
    name: string;
    targetPct: string | null;
    position: number;
  }[];
  categoryAssignments: { symbol: string; categoryId: string | null; targetPct: string | null }[];
  goals: (typeof goal.$inferSelect)[];
}

/**
 * Transactions flattened for CSV, with instrument metadata joined in.
 *
 * Ordered oldest-first on (tradeDate, createdAt, id) — the same triple the
 * transactions list paginates on, and stable enough that two exports of an
 * unchanged portfolio produce identical bytes.
 */
export async function buildTransactionRows(
  db: Database,
  userId: string,
): Promise<ExportTransactionRow[]> {
  const { id: portfolioId } = await getUserPortfolio(db, userId);

  const rows = await db
    .select({
      symbol: transaction.instrumentSymbol,
      type: transaction.type,
      quantity: transaction.quantity,
      price: transaction.price,
      currency: transaction.currency,
      tradeDate: transaction.tradeDate,
      fee: transaction.fee,
      feeCurrency: transaction.feeCurrency,
      source: transaction.source,
      exchange: instrument.exchange,
      name: instrument.name,
    })
    .from(transaction)
    .innerJoin(instrument, eq(instrument.symbol, transaction.instrumentSymbol))
    .where(eq(transaction.portfolioId, portfolioId))
    .orderBy(asc(transaction.tradeDate), asc(transaction.createdAt), asc(transaction.id));

  return rows.map((r) => ({
    symbol: r.symbol,
    type: r.type,
    quantity: r.quantity,
    price: r.price,
    currency: r.currency,
    tradeDate: r.tradeDate,
    fee: r.fee ?? "",
    feeCurrency: r.feeCurrency ?? "",
    exchange: r.exchange,
    name: r.name,
    source: r.source ?? "",
  }));
}

/**
 * Everything the user authored, in one document.
 *
 * Deliberately NOT built on `loadPortfolioBook`: that replays the ledger into
 * positions, and an export wants the ledger itself rather than what it computes
 * to. Provider caches are excluded because they rebuild themselves — and
 * `fx_rate_daily` alone is over 200,000 rows.
 *
 * `now` is injectable so a test can prove two exports are byte-identical.
 */
export async function buildExport(
  db: Database,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<ExportDocument> {
  const { id: portfolioId } = await getUserPortfolio(db, userId);

  const [pf] = await db
    .select({ name: portfolio.name, autoAddDividends: portfolio.autoAddDividends })
    .from(portfolio)
    .where(eq(portfolio.id, portfolioId));

  const [u] = await db
    .select({
      displayCurrency: user.displayCurrency,
      dividendTaxRate: user.dividendTaxRate,
      overviewPrefs: user.overviewPrefs,
      allowNegativeDividendGrowth: user.allowNegativeDividendGrowth,
    })
    .from(user)
    .where(eq(user.id, userId));

  const transactions = await db
    .select({
      id: transaction.id,
      symbol: transaction.instrumentSymbol,
      type: transaction.type,
      quantity: transaction.quantity,
      price: transaction.price,
      currency: transaction.currency,
      fee: transaction.fee,
      feeCurrency: transaction.feeCurrency,
      source: transaction.source,
      tradeDate: transaction.tradeDate,
    })
    .from(transaction)
    .where(eq(transaction.portfolioId, portfolioId))
    .orderBy(asc(transaction.tradeDate), asc(transaction.createdAt), asc(transaction.id));

  const customHoldings = await db
    .select()
    .from(customHolding)
    .where(eq(customHolding.portfolioId, portfolioId))
    .orderBy(asc(customHolding.symbol));

  const categories = await db
    .select({
      id: category.id,
      // Without the parent pointer the export would describe a flat list of
      // names and quietly lose the tree the user built.
      parentId: category.parentId,
      name: category.name,
      targetPct: category.targetPct,
      position: category.position,
    })
    .from(category)
    .where(eq(category.portfolioId, portfolioId))
    .orderBy(asc(category.position), asc(category.name));

  const categoryAssignments = await db
    .select({
      symbol: categoryAssignment.symbol,
      categoryId: categoryAssignment.categoryId,
      targetPct: categoryAssignment.targetPct,
    })
    .from(categoryAssignment)
    .where(eq(categoryAssignment.portfolioId, portfolioId))
    .orderBy(asc(categoryAssignment.symbol));

  const goals = await db
    .select()
    .from(goal)
    .where(eq(goal.portfolioId, portfolioId))
    .orderBy(asc(goal.id));

  // Only symbols this portfolio actually references — a ticker in the file
  // should be self-describing, but the whole instrument table is not the
  // user's data.
  const symbols = [
    ...new Set([...transactions.map((t) => t.symbol), ...customHoldings.map((h) => h.symbol)]),
  ].sort();

  const instruments =
    symbols.length === 0
      ? []
      : await db
          .select({
            symbol: instrument.symbol,
            name: instrument.name,
            exchange: instrument.exchange,
            currency: instrument.currency,
            assetType: instrument.assetType,
            isin: instrument.isin,
          })
          .from(instrument)
          .where(inArray(instrument.symbol, symbols))
          .orderBy(asc(instrument.symbol));

  // manual_price has no portfolio_id column, so unlike `symbols` above this
  // must NOT include symbols that only entered the export via a transaction:
  // ensureInstrument() updates rather than rejects an existing symbol, so a
  // transaction can reference another tenant's custom symbol. Manual prices
  // only ever exist for custom holdings (see the write-side guard in
  // routes/import.ts, "Never overwrite another tenant's price series"), so
  // scoping to this portfolio's own custom-holding symbols loses nothing.
  const customSymbols = customHoldings.map((h) => h.symbol);

  const manualPrices =
    customSymbols.length === 0
      ? []
      : await db
          .select({
            symbol: manualPrice.symbol,
            date: manualPrice.date,
            price: manualPrice.price,
            currency: manualPrice.currency,
          })
          .from(manualPrice)
          .where(inArray(manualPrice.symbol, customSymbols))
          .orderBy(asc(manualPrice.symbol), asc(manualPrice.date));

  return {
    version: EXPORT_VERSION,
    exportedAt: now().toISOString(),
    portfolio: { name: pf?.name ?? "Default", autoAddDividends: pf?.autoAddDividends ?? true },
    user: {
      displayCurrency: u?.displayCurrency ?? null,
      // Left as the string postgres returns. Converting to a number here is
      // exactly the bug this export must not have.
      dividendTaxRate: u?.dividendTaxRate ?? null,
      overviewPrefs: u?.overviewPrefs ?? null,
      allowNegativeDividendGrowth: u?.allowNegativeDividendGrowth ?? true,
    },
    instruments,
    transactions,
    customHoldings,
    manualPrices,
    categories,
    categoryAssignments,
    goals,
  };
}
