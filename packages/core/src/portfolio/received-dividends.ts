import { Decimal } from "../money/decimal";

/** A raw ledger transaction row, as stored. Structural so core stays DB-agnostic. */
export interface LedgerDividendRow {
  symbol: string;
  type: string;
  quantity: string;
  price: string;
  currency: string;
  /** ISO day (YYYY-MM-DD). For a dividend row this is the cash date. */
  tradeDate: string;
  /** 'auto' = written by dividend auto-reconciliation; null = user or import. */
  source: string | null;
}

/** One dividend actually received, as recorded in the ledger. */
export interface ReceivedDividendRow {
  symbol: string;
  /** ISO day the cash landed. */
  cashDate: string;
  income: string;
  currency: string;
  /**
   * Null unless provenance guarantees the per-share convention. Auto-created
   * rows are written by `planAutoDividends` as quantity = shares held and
   * price = amountPerShare. Imported rows follow no such rule — one observed
   * row is `1 x 3.30 DKK` (the total) for a period when 2 shares were held —
   * so a per-share figure cannot be recovered from them and is never guessed.
   */
  amountPerShare: string | null;
  sharesHeld: string | null;
}

/**
 * The dividends a portfolio actually received, from its transaction ledger.
 *
 * This is the recorded truth, and unlike reconstructing income from provider
 * history it covers holdings that have since been fully sold — their payments
 * happened and stay in the ledger forever.
 *
 * Only cash that has landed (`tradeDate <= todayIso`) is included; a dividend
 * whose ex-date has passed but whose payment is still pending has no ledger row
 * at all, and is supplied separately by the synthetic in-flight series.
 */
export function buildReceivedDividends(
  rows: LedgerDividendRow[],
  todayIso: string,
): ReceivedDividendRow[] {
  const out: ReceivedDividendRow[] = [];
  for (const r of rows) {
    if (r.type !== "dividend") continue;
    if (r.tradeDate > todayIso) continue;
    const isAuto = r.source === "auto";
    out.push({
      symbol: r.symbol,
      cashDate: r.tradeDate,
      income: new Decimal(r.quantity).times(new Decimal(r.price)).toFixed(2),
      currency: r.currency,
      amountPerShare: isAuto ? r.price : null,
      sharesHeld: isAuto ? r.quantity : null,
    });
  }
  return out.sort(
    (a, b) => a.cashDate.localeCompare(b.cashDate) || a.symbol.localeCompare(b.symbol),
  );
}
