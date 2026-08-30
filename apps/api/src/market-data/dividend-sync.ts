import { and, eq } from "drizzle-orm";
import { dedupeDividends } from "@sage/core";
import type { IMarketDataProvider } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { dividendHistory, instrument } from "../db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAYMENT_LAG_DAYS = 21;

function isoAddDays(dateStr: string, days: number): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** A dividend row as stored in / written to `dividend_history`. */
export interface StoredDividendRow {
  exDate: string;
  amountPerShare: string;
  currency: string;
  paymentDate: string | null;
  paymentDateEstimated: boolean;
  recordDate: string | null;
  declarationDate: string | null;
  period: string | null;
}

function mergeStoredDividend(
  existing: StoredDividendRow | undefined,
  incoming: StoredDividendRow,
): StoredDividendRow {
  const paymentDate = incoming.paymentDate ?? existing?.paymentDate ?? null;
  return {
    ...incoming,
    paymentDate,
    // A provider-sourced date is authoritative; otherwise inherit the stored
    // row's estimate status (an estimate stays flagged until a real date lands).
    paymentDateEstimated: incoming.paymentDate
      ? false
      : paymentDate
        ? (existing?.paymentDateEstimated ?? false)
        : false,
    recordDate: incoming.recordDate ?? existing?.recordDate ?? null,
    declarationDate: incoming.declarationDate ?? existing?.declarationDate ?? null,
    period: incoming.period ?? existing?.period ?? null,
  };
}

/**
 * Decide how to reconcile a freshly fetched dividend feed against what is
 * already stored, collapsing near-duplicate payments (the same dividend
 * reported by different providers a few days apart) so the table never keeps
 * two rows for one payment.
 *
 * Existing and incoming rows are merged and run through {@link dedupeDividends};
 * the surviving ex-dates define the canonical set. Incoming rows that survive
 * are upserted (fresh amount / payment date win); stored rows whose ex-date did
 * not survive — i.e. they collapsed into a kept row — are deleted. Stored
 * history the feed no longer returns survives on its own and is left untouched.
 */
export function planDividendReconciliation(
  symbol: string,
  existing: StoredDividendRow[],
  incoming: StoredDividendRow[],
): { upserts: StoredDividendRow[]; deleteExDates: string[] } {
  const survivors = dedupeDividends(
    [...existing, ...incoming].map((r) => ({
      symbol,
      exDate: r.exDate,
      amountPerShare: r.amountPerShare,
      currency: r.currency,
    })),
  );
  const survivorExDates = new Set(survivors.map((r) => r.exDate));

  const existingByExDate = new Map(existing.map((r) => [r.exDate, r]));
  const upserts = incoming
    .filter((r) => survivorExDates.has(r.exDate))
    .map((r) => mergeStoredDividend(existingByExDate.get(r.exDate), r));
  const deleteExDates = existing
    .map((r) => r.exDate)
    .filter((exDate) => !survivorExDates.has(exDate));

  return { upserts, deleteExDates };
}

/**
 * For rows without a provider-sourced payment date, estimate one as
 * ex-date + the symbol's median observed ex->pay lag (default 21 days when the
 * symbol has no real payment dates at all). Previously estimated dates are
 * re-derived; provider-sourced dates are never touched.
 */
export function planPaymentDateEstimates(
  rows: StoredDividendRow[],
  defaultLagDays = DEFAULT_PAYMENT_LAG_DAYS,
): { exDate: string; paymentDate: string }[] {
  const lags = rows
    .filter((r) => r.paymentDate && !r.paymentDateEstimated)
    .map(
      (r) =>
        (new Date(`${r.paymentDate}T00:00:00Z`).getTime() -
          new Date(`${r.exDate}T00:00:00Z`).getTime()) /
        DAY_MS,
    )
    .filter((lag) => lag >= 0)
    .sort((a, b) => a - b);

  const lag = lags.length > 0 ? lags[Math.floor(lags.length / 2)]! : defaultLagDays;

  return rows
    .filter((r) => !r.paymentDate || r.paymentDateEstimated)
    .map((r) => ({ exDate: r.exDate, paymentDate: isoAddDays(r.exDate, lag) }))
    .filter((estimate) => {
      const current = rows.find((r) => r.exDate === estimate.exDate);
      return current?.paymentDate !== estimate.paymentDate;
    });
}

export async function syncDividends(
  db: Database,
  providers: IMarketDataProvider[],
  symbol: string,
): Promise<number> {
  const [inst] = await db.select().from(instrument).where(eq(instrument.symbol, symbol));
  if (!inst) return 0;
  // Custom instruments never have provider dividends; their income rows are
  // written by the custom-income engine and must not be reconciled against an
  // (empty) provider feed — that could delete them.
  if (inst.assetType === "custom") return 0;

  let dividends;
  for (const provider of providers) {
    try {
      dividends = await provider.getDividendHistory(symbol);
      break;
    } catch (err) {
      if (provider === providers[providers.length - 1]) {
        console.warn(
          `dividend sync failed for ${symbol}:`,
          err instanceof Error ? err.message : err,
        );
        return 0;
      }
    }
  }
  if (!dividends) return 0;

  if (dividends.length === 0) return 0;

  const incoming: StoredDividendRow[] = dividends.map((d) => ({
    exDate: d.exDividendDate.toISOString().slice(0, 10),
    amountPerShare: d.amountPerShare.toDecimal().toFixed(),
    currency: d.amountPerShare.currency,
    paymentDate: d.paymentDate ? d.paymentDate.toISOString().slice(0, 10) : null,
    paymentDateEstimated: false,
    recordDate: d.recordDate ? d.recordDate.toISOString().slice(0, 10) : null,
    declarationDate: d.announcedDate ? d.announcedDate.toISOString().slice(0, 10) : null,
    period: d.period,
  }));

  const existing = await db
    .select()
    .from(dividendHistory)
    .where(eq(dividendHistory.symbol, symbol));

  const { upserts, deleteExDates } = planDividendReconciliation(
    symbol,
    existing.map((r) => ({
      exDate: r.exDate,
      amountPerShare: r.amountPerShare,
      currency: r.currency,
      paymentDate: r.paymentDate,
      paymentDateEstimated: r.paymentDateEstimated,
      recordDate: r.recordDate,
      declarationDate: r.declarationDate,
      period: r.period,
    })),
    incoming,
  );

  // Drop stored rows that collapsed into a kept near-duplicate, then upsert the
  // surviving payments with the freshest amount / payment date.
  for (const exDate of deleteExDates) {
    await db
      .delete(dividendHistory)
      .where(and(eq(dividendHistory.symbol, symbol), eq(dividendHistory.exDate, exDate)));
  }

  for (const row of upserts) {
    await db
      .insert(dividendHistory)
      .values({ symbol, ...row, source: "provider" as const })
      .onConflictDoUpdate({
        target: [dividendHistory.symbol, dividendHistory.exDate],
        set: {
          amountPerShare: row.amountPerShare,
          currency: row.currency,
          paymentDate: row.paymentDate,
          paymentDateEstimated: row.paymentDateEstimated,
          recordDate: row.recordDate,
          declarationDate: row.declarationDate,
          period: row.period,
          fetchedAt: new Date(),
        },
      });
  }

  const stored = await db.select().from(dividendHistory).where(eq(dividendHistory.symbol, symbol));
  const estimates = planPaymentDateEstimates(
    stored.map((r) => ({
      exDate: r.exDate,
      amountPerShare: r.amountPerShare,
      currency: r.currency,
      paymentDate: r.paymentDate,
      paymentDateEstimated: r.paymentDateEstimated,
      recordDate: r.recordDate,
      declarationDate: r.declarationDate,
      period: r.period,
    })),
  );
  for (const e of estimates) {
    await db
      .update(dividendHistory)
      .set({ paymentDate: e.paymentDate, paymentDateEstimated: true })
      .where(and(eq(dividendHistory.symbol, symbol), eq(dividendHistory.exDate, e.exDate)));
  }

  return upserts.length;
}

export async function syncAllPositionDividends(
  db: Database,
  providers: IMarketDataProvider[],
  symbols: string[],
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  for (const symbol of symbols) {
    const count = await syncDividends(db, providers, symbol);
    results.set(symbol, count);
  }
  return results;
}
