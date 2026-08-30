import { and, eq } from "drizzle-orm";
import {
  Decimal,
  Money,
  accrueGrossIncome,
  incomePaymentDates,
  replayHoldings,
  type IncomeFrequencyUnit,
  type PositionTransaction,
} from "@sage/core";
import type { Database } from "../db/client";
import { customHolding, customIncome, dividendHistory, transaction, user } from "../db/schema";
import { getUserPortfolio } from "../auth";
import { resolvePricePoints, type PricePoint } from "../market-data/manual-price-provider";

const inFlightUsers = new Set<string>();

/** price on a date = latest point at or before it (marks win over tx prices —
 *  resolvePricePoints already encodes that); zero before the first point. */
function priceOn(points: PricePoint[], date: string): Decimal {
  let price = new Decimal(0);
  for (const p of points) {
    if (p.date > date) break;
    price = p.price;
  }
  return price;
}

/**
 * Materialize due custom-holding income payments (spec 2026-07-18 §3).
 * Idempotent via the custom_income ledger; a ledger row with a null
 * transactionId is a tombstone (user deleted the payment — never resurrect).
 * Fire-and-forget from routes: failures are logged, never fatal to a page.
 * In-flight runs are deduped per user (the custom_income unique constraint
 * already makes concurrent runs correctness-safe across users). A single
 * holding with bad data cannot abort the rest of the sync: per-holding
 * failures are caught and reported via console.warn rather than thrown.
 */
export async function syncCustomIncome(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<void> {
  if (inFlightUsers.has(userId)) return;
  inFlightUsers.add(userId);
  try {
    await runSync(db, userId, now);
  } finally {
    inFlightUsers.delete(userId);
  }
}

async function runSync(db: Database, userId: string, now: Date): Promise<void> {
  const { id: portfolioId } = await getUserPortfolio(db, userId);
  const holdings = await db
    .select()
    .from(customHolding)
    .where(
      and(
        eq(customHolding.portfolioId, portfolioId),
        eq(customHolding.incomeEnabled, true),
        eq(customHolding.autoAdd, true),
      ),
    );
  const active = holdings.filter(
    (h) => h.incomeYearlyPct !== null && h.frequencyUnit !== null && h.firstPaymentDate !== null,
  );
  if (active.length === 0) return;

  const [userRow] = await db
    .select({ taxRate: user.dividendTaxRate })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const taxRate = userRow?.taxRate == null ? new Decimal(0) : new Decimal(userRow.taxRate);
  const today = now.toISOString().slice(0, 10);

  for (const holding of active) {
    try {
      await syncHolding(db, portfolioId, holding, taxRate, today);
    } catch (err) {
      console.warn(
        `custom income sync failed for ${holding.symbol}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function syncHolding(
  db: Database,
  portfolioId: string,
  holding: typeof customHolding.$inferSelect,
  taxRate: Decimal,
  today: string,
): Promise<void> {
  const symbol = holding.symbol;
  const dueDates = incomePaymentDates({
    firstPaymentDate: holding.firstPaymentDate!,
    lastPaymentDate: holding.lastPaymentDate,
    unit: holding.frequencyUnit as IncomeFrequencyUnit,
    interval: holding.frequencyInterval,
    until: today,
  });
  if (dueDates.length === 0) return;

  const ledgerRows = await db
    .select({ payDate: customIncome.payDate })
    .from(customIncome)
    .where(and(eq(customIncome.portfolioId, portfolioId), eq(customIncome.symbol, symbol)));
  const claimed = new Set(ledgerRows.map((r) => r.payDate));

  const points = await resolvePricePoints(db, symbol);

  // ascending, so reinvested credits compound into later windows
  for (let i = 0; i < dueDates.length; i++) {
    const payDate = dueDates[i]!;
    if (claimed.has(payDate)) continue;

    // fresh tx read each payment: earlier iterations may have inserted credits
    const txRows = await db
      .select()
      .from(transaction)
      .where(
        and(eq(transaction.portfolioId, portfolioId), eq(transaction.instrumentSymbol, symbol)),
      );

    // Imported-history backfill (Task 6) claims existing rows here; the
    // fresh path below only runs when no imported row covers this payment.
    const claimedExisting = await claimImportedPayment(
      db,
      portfolioId,
      symbol,
      payDate,
      holding.reinvest,
      txRows,
      points,
    );
    if (claimedExisting) continue;

    const positionTxs: PositionTransaction[] = txRows.map((t) => ({
      symbol: t.instrumentSymbol,
      type: t.type as PositionTransaction["type"],
      quantity: new Decimal(t.quantity),
      price: Money.of(t.price, t.currency),
      tradeDate: new Date(`${t.tradeDate}T00:00:00Z`),
    }));
    const timeline = replayHoldings(positionTxs);
    if (timeline.firstTransactionDate === null) continue;

    const start = i > 0 ? dueDates[i - 1]! : timeline.firstTransactionDate;
    const gross = accrueGrossIncome({
      start,
      end: payDate,
      yearlyPct: new Decimal(holding.incomeYearlyPct!),
      valueOn: (date) => {
        const qty = timeline.asOf(date).quantities.get(symbol) ?? new Decimal(0);
        return qty.times(priceOn(points, date));
      },
    });
    // Sub-cent gross = no payment. Guards dust balances left by rounded imports
    // (Snowball exports credited shares at 8dp; a re-imported sold-out holding
    // keeps ~1e-8 units) — without this the engine mints microscopic reinvest
    // rows on every schedule tick forever. No ledger row: nothing was paid.
    if (gross.lessThan("0.005")) continue;

    const tax = gross.times(taxRate).dividedBy(100);
    const net = gross.minus(tax);
    const priceAtPay = priceOn(points, payDate);
    if (priceAtPay.isZero()) continue; // unpriceable — cannot credit shares

    const currency = timeline.currencyOf(symbol);
    await db.transaction(async (dbtx) => {
      const claimedRow = await dbtx
        .insert(customIncome)
        .values({ portfolioId, symbol, payDate })
        .onConflictDoNothing()
        .returning({ id: customIncome.id });
      if (claimedRow.length === 0) return; // raced or tombstoned

      const [created] = holding.reinvest
        ? await dbtx
            .insert(transaction)
            .values({
              portfolioId,
              instrumentSymbol: symbol,
              type: "buy",
              quantity: net.dividedBy(priceAtPay).toFixed(),
              price: "0",
              currency,
              fee: tax.isZero() ? null : tax.toFixed(),
              feeCurrency: tax.isZero() ? null : currency,
              tradeDate: payDate,
              source: "custom-income",
            })
            .returning({ id: transaction.id })
        : await dbtx
            .insert(transaction)
            .values({
              portfolioId,
              instrumentSymbol: symbol,
              type: "dividend",
              quantity: "1",
              // INVARIANT: every ledger `dividend` row's income (quantity ×
              // price) must be GROSS, uniformly — buildReceivedDividends
              // reads it directly as received income, and the web client
              // applies the user's flat tax rate on top of that. Writing net
              // here would understate history AND get taxed a second time
              // client-side. Tax is recorded separately via `fee`.
              price: gross.toFixed(),
              currency,
              fee: tax.isZero() ? null : tax.toFixed(),
              feeCurrency: tax.isZero() ? null : currency,
              tradeDate: payDate,
              source: "custom-income",
            })
            .returning({ id: transaction.id });
      await dbtx
        .update(customIncome)
        .set({ transactionId: created!.id })
        .where(eq(customIncome.id, claimedRow[0]!.id));

      // amountPerShare uses shares held ON the ex-date INCLUDING the credit,
      // matching core's sharesHeldOn(≤ exDate) so retro income == gross.
      const sharesAtPay = holding.reinvest
        ? (timeline.asOf(payDate).quantities.get(symbol) ?? new Decimal(0)).plus(
            net.dividedBy(priceAtPay),
          )
        : (timeline.asOf(payDate).quantities.get(symbol) ?? new Decimal(0));
      if (!sharesAtPay.isZero()) {
        await dbtx
          .insert(dividendHistory)
          .values({
            symbol,
            exDate: payDate,
            amountPerShare: gross.dividedBy(sharesAtPay).toFixed(),
            currency,
            paymentDate: payDate,
            source: "custom",
          })
          .onConflictDoNothing();
      }
    });
  }
}

type TxRow = typeof transaction.$inferSelect;

/** If an imported (source-null) row already records this payment — a price-0
 *  buy when reinvested, a dividend otherwise, on exactly the payment date
 *  (Snowball's export dates walk the same schedule) — claim it: ledger row,
 *  plus a dividend_history row reconstructed from broker values
 *  (gross = credited amount + FeeTax). Snowball's numbers win over
 *  recomputation for historical payments. */
async function claimImportedPayment(
  db: Database,
  portfolioId: string,
  symbol: string,
  payDate: string,
  reinvest: boolean,
  txRows: TxRow[],
  points: PricePoint[],
): Promise<boolean> {
  const candidate = txRows.find(
    (t) =>
      t.tradeDate === payDate &&
      t.source === null &&
      (reinvest ? t.type === "buy" && new Decimal(t.price).isZero() : t.type === "dividend"),
  );
  if (!candidate) return false;

  const price = priceOn(points, payDate);
  const credited = reinvest
    ? new Decimal(candidate.quantity).times(price)
    : new Decimal(candidate.quantity).times(new Decimal(candidate.price));
  const fee = candidate.fee === null ? new Decimal(0) : new Decimal(candidate.fee);
  const gross = credited.plus(fee);

  const positionTxs: PositionTransaction[] = txRows.map((t) => ({
    symbol: t.instrumentSymbol,
    type: t.type as PositionTransaction["type"],
    quantity: new Decimal(t.quantity),
    price: Money.of(t.price, t.currency),
    tradeDate: new Date(`${t.tradeDate}T00:00:00Z`),
  }));
  const sharesAtPay = replayHoldings(positionTxs).asOf(payDate).quantities.get(symbol);

  await db.transaction(async (dbtx) => {
    const claimedRow = await dbtx
      .insert(customIncome)
      .values({ portfolioId, symbol, payDate, transactionId: candidate.id })
      .onConflictDoNothing()
      .returning({ id: customIncome.id });
    if (claimedRow.length === 0) return;
    if (sharesAtPay && !sharesAtPay.isZero() && !gross.isZero()) {
      await dbtx
        .insert(dividendHistory)
        .values({
          symbol,
          exDate: payDate,
          amountPerShare: gross.dividedBy(sharesAtPay).toFixed(),
          currency: candidate.currency,
          paymentDate: payDate,
          source: "custom",
        })
        .onConflictDoNothing();
    }
  });
  return true;
}
