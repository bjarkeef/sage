import type { TransactionType } from "../lib/types";
import { parseDecimalInput } from "../lib/decimal-input";

export interface SummaryInput {
  type: TransactionType;
  quantity: string;
  price: string;
  fee: string;
}

export interface Summary {
  /** "Total" for a trade, "Total received" for a dividend. */
  label: string;
  /** null while the inputs are incomplete — never a zero standing in for
   *  "nothing entered yet", which reads as a real figure. */
  amount: number | null;
  /** The arithmetic, so the figure is checkable: "10 × 305.93". No currency
   *  symbol — the caller formats the amount and owns currency. */
  breakdown: string | null;
}

/**
 * The figure shown above the dialog's footer.
 *
 * Display-only, so plain float arithmetic is fine here: the result is passed
 * straight to `formatMoney`, which rounds to the currency's minor units. Stored
 * money still goes through the API in decimal string form, untouched by this.
 *
 * Returns null for splits, which move no money at all.
 */
export function summarize({ type, quantity, price, fee }: SummaryInput): Summary | null {
  if (type === "split") return null;

  const label = type === "dividend" ? "Total received" : "Total";
  const qty = parseDecimalInput(quantity);
  const unit = parseDecimalInput(price);
  if (qty === null || unit === null) return { label, amount: null, breakdown: null };

  const gross = qty * unit;
  // Fee only applies to trades; the field is hidden for dividends, and a value
  // left over from a previous type must not silently change the figure.
  const feeAmount = type === "buy" || type === "sell" ? (parseDecimalInput(fee) ?? 0) : 0;
  const amount = type === "sell" ? gross - feeAmount : gross + feeAmount;

  return { label, amount, breakdown: `${quantity.trim()} × ${price.trim()}` };
}

/**
 * One line naming what was just written to the ledger, for a save confirmation.
 *
 * Quantity means something different per type — shares for a trade, shares held
 * for a dividend, a ratio for a split — so only the types where it reads as a
 * share count show it.
 */
export function describeSavedTransaction(input: {
  type: TransactionType;
  quantity: string;
  symbol: string;
}): string {
  const qty = input.quantity.trim();
  switch (input.type) {
    case "buy":
      return `Bought ${qty} ${input.symbol}`;
    case "sell":
      return `Sold ${qty} ${input.symbol}`;
    case "dividend":
      return `Dividend from ${input.symbol}`;
    case "split":
      return `Split recorded for ${input.symbol}`;
  }
}
