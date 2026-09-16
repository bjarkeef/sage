import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Decimal, MATCH_WINDOW_DAYS } from "@sage/core";
import type { Database } from "../db/client";
import { autoDividend, importRow, transaction } from "../db/schema";
import type { ImportTransaction } from "./types";

/** Canonical decimal string: full precision, no exponent notation, no
 *  trailing zeros. "10", "10.0" and "1e1" all normalize to "10", so
 *  formatting differences can never defeat duplicate detection. */
export function normalizeDecimal(value: string): string {
  return new Decimal(value).toFixed();
}

/** The content fields that define a row's identity. Matches both parsed CSV
 *  rows and `transaction` DB rows (via field mapping). Fees and source are
 *  deliberately excluded — a re-export that corrects a fee must not
 *  re-create the trade, and the same trade arriving from another importer
 *  must still be recognized. */
export interface HashableRow {
  symbol: string;
  type: string;
  tradeDate: string;
  quantity: string;
  price: string;
  currency: string;
}

export function computeRowHash(row: HashableRow): string {
  const input = [
    row.symbol,
    row.type,
    row.tradeDate,
    normalizeDecimal(row.quantity),
    normalizeDecimal(row.price),
    row.currency,
  ].join("|");
  return createHash("sha256").update(input).digest("hex");
}

export interface HashedRow {
  tx: ImportTransaction;
  rowHash: string;
  occurrence: number;
}

/** Identical rows within one file get occurrence indices 0, 1, 2… in file
 *  order, so two genuine same-day identical trades are distinct identities. */
export function assignOccurrences(txs: ImportTransaction[]): HashedRow[] {
  const counts = new Map<string, number>();
  return txs.map((tx) => {
    const rowHash = computeRowHash(tx);
    const occurrence = counts.get(rowHash) ?? 0;
    counts.set(rowHash, occurrence + 1);
    return { tx, rowHash, occurrence };
  });
}

export type Disposition =
  | "insert"
  | "already-imported"
  | "tombstoned"
  | "claim-existing"
  | "adopt-auto"
  | "adopt-custom-income";

export interface PlannedRow {
  tx: ImportTransaction;
  rowHash: string;
  occurrence: number;
  disposition: Disposition;
  /** set for "claim-existing": the unclaimed transaction to link */
  claimTransactionId?: string;
  /** set for "adopt-auto" and "adopt-custom-income": the generated transaction
   *  to overwrite + link */
  adoptTransactionId?: string;
  /** set for "tombstoned": the ledger row to re-link on restore */
  ledgerId?: string;
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** One-to-one nearest-first pairing of incoming dividend rows (by plan index)
 *  with auto-created transactions, within ±MATCH_WINDOW_DAYS. Same rule the
 *  reconciliation engine uses for detection — the two sides of the dedup
 *  contract must agree on what "the same dividend" means. */
export function pairIncomingWithAutoRows(
  incoming: { index: number; tradeDate: string }[],
  autoRows: { transactionId: string; tradeDate: string }[],
): Map<number, string> {
  const pairs: { i: number; a: number; dist: number }[] = [];
  incoming.forEach((row, i) => {
    autoRows.forEach((candidate, a) => {
      const dist = dayDistance(row.tradeDate, candidate.tradeDate);
      if (dist <= MATCH_WINDOW_DAYS) pairs.push({ i, a, dist });
    });
  });
  pairs.sort((x, y) => x.dist - y.dist || x.i - y.i || x.a - y.a);
  const result = new Map<number, string>();
  const usedIncoming = new Set<number>();
  const usedAuto = new Set<number>();
  for (const p of pairs) {
    if (usedIncoming.has(p.i) || usedAuto.has(p.a)) continue;
    usedIncoming.add(p.i);
    usedAuto.add(p.a);
    result.set(incoming[p.i]!.index, autoRows[p.a]!.transactionId);
  }
  return result;
}

/** Decide, read-only, what each parsed row would do on commit. Used verbatim
 *  by preview (dry run) and by commit (before executeImport). */
export async function planImport(
  db: Database,
  portfolioId: string,
  txs: ImportTransaction[],
): Promise<PlannedRow[]> {
  const hashed = assignOccurrences(txs);
  if (hashed.length === 0) return [];

  const hashes = [...new Set(hashed.map((h) => h.rowHash))];
  const ledgerRows = await db
    .select({
      id: importRow.id,
      rowHash: importRow.rowHash,
      occurrence: importRow.occurrence,
      transactionId: importRow.transactionId,
    })
    .from(importRow)
    .where(and(eq(importRow.portfolioId, portfolioId), inArray(importRow.rowHash, hashes)));

  const ledgerByKey = new Map(
    ledgerRows.map((r) => [
      `${r.rowHash}:${r.occurrence}`,
      { id: r.id, transactionId: r.transactionId },
    ]),
  );

  // Existing transactions with no ledger row: manually entered, or imported
  // before the ledger existed. Content matches against these are CLAIMED
  // (ledger row written, nothing inserted) — the ledger self-backfills.
  // Auto-created dividends (source='auto') are excluded: they must resolve
  // ONLY through adopt-auto post-processing below, which clears `source`.
  // claim-existing's execute case never touches `source`, so if an auto row
  // slipped into this pool it would keep source='auto' forever despite now
  // being import-backed, and would remain adoptable again by a later import.
  const unclaimed = await db
    .select({
      id: transaction.id,
      instrumentSymbol: transaction.instrumentSymbol,
      type: transaction.type,
      quantity: transaction.quantity,
      price: transaction.price,
      currency: transaction.currency,
      tradeDate: transaction.tradeDate,
    })
    .from(transaction)
    .leftJoin(importRow, eq(importRow.transactionId, transaction.id))
    .where(
      and(
        eq(transaction.portfolioId, portfolioId),
        isNull(importRow.id),
        isNull(transaction.source),
      ),
    );

  const claimQueues = new Map<string, string[]>();
  for (const t of unclaimed) {
    const hash = computeRowHash({
      symbol: t.instrumentSymbol,
      type: t.type,
      tradeDate: t.tradeDate,
      quantity: t.quantity,
      price: t.price,
      currency: t.currency,
    });
    const queue = claimQueues.get(hash) ?? [];
    queue.push(t.id);
    claimQueues.set(hash, queue);
  }

  const planned: PlannedRow[] = hashed.map(({ tx, rowHash, occurrence }) => {
    const ledger = ledgerByKey.get(`${rowHash}:${occurrence}`);
    if (ledger) {
      if (ledger.transactionId !== null) {
        return { tx, rowHash, occurrence, disposition: "already-imported" as const };
      }
      return { tx, rowHash, occurrence, disposition: "tombstoned" as const, ledgerId: ledger.id };
    }
    const queue = claimQueues.get(rowHash);
    if (queue !== undefined && queue.length > 0) {
      const claimTransactionId = queue.shift()!;
      return {
        tx,
        rowHash,
        occurrence,
        disposition: "claim-existing" as const,
        claimTransactionId,
      };
    }
    return { tx, rowHash, occurrence, disposition: "insert" as const };
  });

  // Import adoption: an incoming dividend that reconciliation already
  // auto-created must UPDATE that row (broker truth), not duplicate it.
  const dividendInserts = planned
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.disposition === "insert" && row.tx.type === "dividend");
  if (dividendInserts.length > 0) {
    const symbols = [...new Set(dividendInserts.map(({ row }) => row.tx.symbol))];
    const autoRows = await db
      .select({
        transactionId: transaction.id,
        symbol: transaction.instrumentSymbol,
        tradeDate: transaction.tradeDate,
      })
      .from(autoDividend)
      .innerJoin(transaction, eq(transaction.id, autoDividend.transactionId))
      .where(
        and(
          eq(autoDividend.portfolioId, portfolioId),
          eq(transaction.source, "auto"),
          eq(transaction.type, "dividend"),
          inArray(transaction.instrumentSymbol, symbols),
        ),
      );
    const autoBySymbol = new Map<string, { transactionId: string; tradeDate: string }[]>();
    for (const a of autoRows) {
      const list = autoBySymbol.get(a.symbol) ?? [];
      list.push({ transactionId: a.transactionId, tradeDate: a.tradeDate });
      autoBySymbol.set(a.symbol, list);
    }
    for (const symbol of symbols) {
      const candidates = autoBySymbol.get(symbol);
      if (!candidates?.length) continue;
      const incoming = dividendInserts
        .filter(({ row }) => row.tx.symbol === symbol)
        .map(({ row, index }) => ({ index, tradeDate: row.tx.tradeDate }));
      const adoptions = pairIncomingWithAutoRows(incoming, candidates);
      for (const [planIndex, adoptTransactionId] of adoptions) {
        planned[planIndex] = {
          ...planned[planIndex]!,
          disposition: "adopt-auto",
          adoptTransactionId,
        };
      }
    }
  }

  // Custom-income adoption: the same rule for a payment the custom-income
  // engine minted before the broker's export arrived. Content-matching cannot
  // see it — the engine keeps full precision where a broker rounds to 8dp — so
  // the match is the payment's identity instead: symbol, type and pay date,
  // exactly, one-to-one. The engine's own ledger row keeps pointing at the
  // adopted transaction, so it never mints that pay date again.
  const remaining = planned
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.disposition === "insert");
  if (remaining.length > 0) {
    const symbols = [...new Set(remaining.map(({ row }) => row.tx.symbol))];
    const generated = await db
      .select({
        id: transaction.id,
        symbol: transaction.instrumentSymbol,
        type: transaction.type,
        tradeDate: transaction.tradeDate,
      })
      .from(transaction)
      .leftJoin(importRow, eq(importRow.transactionId, transaction.id))
      .where(
        and(
          eq(transaction.portfolioId, portfolioId),
          eq(transaction.source, "custom-income"),
          isNull(importRow.id),
          inArray(transaction.instrumentSymbol, symbols),
        ),
      );
    const byIdentity = new Map<string, string[]>();
    for (const g of generated) {
      const key = `${g.symbol}|${g.type}|${g.tradeDate}`;
      const list = byIdentity.get(key) ?? [];
      list.push(g.id);
      byIdentity.set(key, list);
    }
    for (const { row, index } of remaining) {
      const queue = byIdentity.get(`${row.tx.symbol}|${row.tx.type}|${row.tx.tradeDate}`);
      if (!queue?.length) continue;
      planned[index] = {
        ...row,
        disposition: "adopt-custom-income",
        adoptTransactionId: queue.shift()!,
      };
    }
  }

  return planned;
}

export interface ExecuteResult {
  inserted: number;
  claimed: number;
  adopted: number;
  restored: number;
  alreadyImported: number;
  tombstonedSkipped: number;
  /** symbols of inserted + restored rows — feed dividend sync / ISIN resolve */
  syncSymbols: string[];
}

function toTransactionValues(portfolioId: string, tx: ImportTransaction) {
  return {
    portfolioId,
    instrumentSymbol: tx.symbol,
    type: tx.type,
    quantity: tx.quantity,
    price: tx.price,
    currency: tx.currency,
    fee: tx.fee,
    feeCurrency: tx.feeCurrency,
    tradeDate: tx.tradeDate,
  };
}

/** Apply a plan atomically. Ledger-first: claim the identity row (ON CONFLICT
 *  DO NOTHING), and only create the transaction when the claim landed — a
 *  concurrent commit that raced us wins the identity and we count the row as
 *  already imported. The unique index makes double-insert structurally
 *  impossible. */
export async function executeImport(
  db: Database,
  portfolioId: string,
  source: string,
  plan: PlannedRow[],
  opts: { restoreDeleted: boolean },
): Promise<ExecuteResult> {
  const result: ExecuteResult = {
    inserted: 0,
    claimed: 0,
    adopted: 0,
    restored: 0,
    alreadyImported: 0,
    tombstonedSkipped: 0,
    syncSymbols: [],
  };
  const syncSymbols = new Set<string>();

  await db.transaction(async (dbtx) => {
    for (const row of plan) {
      switch (row.disposition) {
        case "already-imported": {
          result.alreadyImported += 1;
          break;
        }
        case "claim-existing": {
          const landed = await dbtx
            .insert(importRow)
            .values({
              portfolioId,
              source,
              rowHash: row.rowHash,
              occurrence: row.occurrence,
              transactionId: row.claimTransactionId!,
            })
            .onConflictDoNothing()
            .returning({ id: importRow.id });
          if (landed.length > 0) result.claimed += 1;
          else result.alreadyImported += 1;
          break;
        }
        case "tombstoned": {
          if (!opts.restoreDeleted) {
            result.tombstonedSkipped += 1;
            break;
          }
          const [created] = await dbtx
            .insert(transaction)
            .values(toTransactionValues(portfolioId, row.tx))
            .returning({ id: transaction.id });
          const relinked = await dbtx
            .update(importRow)
            .set({ transactionId: created!.id })
            .where(and(eq(importRow.id, row.ledgerId!), isNull(importRow.transactionId)))
            .returning({ id: importRow.id });
          if (relinked.length === 0) {
            // A concurrent commit restored this row first; undo our insert.
            await dbtx.delete(transaction).where(eq(transaction.id, created!.id));
            result.alreadyImported += 1;
          } else {
            result.restored += 1;
            syncSymbols.add(row.tx.symbol);
          }
          break;
        }
        case "insert": {
          const landed = await dbtx
            .insert(importRow)
            .values({ portfolioId, source, rowHash: row.rowHash, occurrence: row.occurrence })
            .onConflictDoNothing()
            .returning({ id: importRow.id });
          if (landed.length === 0) {
            result.alreadyImported += 1;
            break;
          }
          const [created] = await dbtx
            .insert(transaction)
            .values(toTransactionValues(portfolioId, row.tx))
            .returning({ id: transaction.id });
          await dbtx
            .update(importRow)
            .set({ transactionId: created!.id })
            .where(eq(importRow.id, landed[0]!.id));
          result.inserted += 1;
          syncSymbols.add(row.tx.symbol);
          break;
        }
        case "adopt-auto":
        case "adopt-custom-income": {
          const landed = await dbtx
            .insert(importRow)
            .values({
              portfolioId,
              source,
              rowHash: row.rowHash,
              occurrence: row.occurrence,
              transactionId: row.adoptTransactionId!,
            })
            .onConflictDoNothing()
            .returning({ id: importRow.id });
          if (landed.length === 0) {
            result.alreadyImported += 1;
            break;
          }
          // Broker values win; the row stops being generated. The auto_dividend
          // or custom_income ledger entry keeps its FK, so reconciliation or
          // the income engine still sees this date as covered.
          await dbtx
            .update(transaction)
            .set({
              quantity: row.tx.quantity,
              price: row.tx.price,
              currency: row.tx.currency,
              fee: row.tx.fee,
              feeCurrency: row.tx.feeCurrency,
              tradeDate: row.tx.tradeDate,
              source: null,
            })
            .where(eq(transaction.id, row.adoptTransactionId!));
          result.adopted += 1;
          break;
        }
      }
    }
  });

  result.syncSymbols = [...syncSymbols];
  return result;
}
