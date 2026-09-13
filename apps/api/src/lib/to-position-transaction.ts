import { Decimal, Money, type PositionTransaction } from "@sage/core";

/** The fee columns as they sit on a `transaction` row. */
export interface FeeColumns {
  fee?: string | null;
  feeCurrency?: string | null;
}

/**
 * A row's fee expressed in the trade's own currency, or null when it cannot be.
 *
 * Almost every fee is already denominated in the currency of the trade it
 * belongs to — 159 of 163 on the reporting book. The exceptions are real
 * though, and not small: four USD purchases were charged in DKK at around 90
 * kroner each, one of them on a holding that is still open and worth 2,296. So
 * a mismatch is converted rather than waved through or dropped, and only a
 * conversion that is genuinely unavailable returns null.
 *
 * `rateOn` is the same shape the replay lookups take: units of `currency` per
 * reporting unit on that date, null when the date or currency cannot be priced.
 */
export function feeInTradeCurrency(
  row: FeeColumns & { currency: string; tradeDate: string },
  rateOn?: (date: string, currency: string) => Decimal | null,
): Money | null {
  if (row.fee == null || row.fee === "") return null;
  const amount = new Decimal(row.fee);
  if (amount.isZero()) return null;
  const from = row.feeCurrency ?? row.currency;
  if (from === row.currency) return Money.of(amount, row.currency);
  if (!rateOn) return null;
  const fromRate = rateOn(row.tradeDate, from);
  const toRate = rateOn(row.tradeDate, row.currency);
  if (!fromRate || !toRate || fromRate.isZero()) return null;
  return Money.of(amount.dividedBy(fromRate).times(toRate), row.currency);
}

/** Map a DB transaction row into a PositionTransaction with a stable sequence. */
export function toPositionTransaction(
  row: {
    id?: string;
    instrumentSymbol: string;
    type: string;
    quantity: string;
    price: string;
    currency: string;
    tradeDate: string;
    createdAt?: Date | string | null;
  } & FeeColumns,
  rateOn?: (date: string, currency: string) => Decimal | null,
): PositionTransaction {
  const created =
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : typeof row.createdAt === "string"
        ? row.createdAt
        : "";
  const fee = feeInTradeCurrency(row, rateOn);
  return {
    symbol: row.instrumentSymbol,
    type: row.type as PositionTransaction["type"],
    quantity: new Decimal(row.quantity),
    price: Money.of(row.price, row.currency),
    tradeDate: new Date(`${row.tradeDate}T00:00:00Z`),
    sequence: `${created}|${row.id ?? ""}`,
    ...(fee ? { fee } : {}),
  };
}
