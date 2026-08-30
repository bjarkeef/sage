import type { ChipProps } from "@sage/ui";
import type { TransactionRow, TransactionType } from "./types";

/** Chip tone per transaction type. Shared so the ledger page and the asset
 *  page cannot drift into showing the same transaction in different colours. */
export const typeChipTone: Record<TransactionType, ChipProps["tone"]> = {
  buy: "primary",
  sell: "neutral",
  split: "neutral",
  dividend: "income",
};

/**
 * Display-only: qty × price as a localized total, e.g. "$4.05".
 *
 * Plain float arithmetic is fine because the result is formatted immediately
 * and never stored — money going back to the API stays a decimal string. Falls
 * back to the raw components rather than printing NaN when either side is not
 * a finite number.
 */
export function totalLabel(r: TransactionRow): string {
  const total = Number(r.quantity) * Number(r.price);
  if (!Number.isFinite(total)) return `${r.quantity} × ${r.price} ${r.currency}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: r.currency }).format(total);
}
