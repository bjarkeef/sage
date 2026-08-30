import { Decimal, Money, type PositionTransaction } from "@sage/core";

/** Map a DB transaction row into a PositionTransaction with a stable sequence. */
export function toPositionTransaction(row: {
  id?: string;
  instrumentSymbol: string;
  type: string;
  quantity: string;
  price: string;
  currency: string;
  tradeDate: string;
  createdAt?: Date | string | null;
}): PositionTransaction {
  const created =
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : typeof row.createdAt === "string"
        ? row.createdAt
        : "";
  return {
    symbol: row.instrumentSymbol,
    type: row.type as PositionTransaction["type"],
    quantity: new Decimal(row.quantity),
    price: Money.of(row.price, row.currency),
    tradeDate: new Date(`${row.tradeDate}T00:00:00Z`),
    sequence: `${created}|${row.id ?? ""}`,
  };
}
