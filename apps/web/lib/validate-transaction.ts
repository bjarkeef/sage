import type { CreateTransactionInput, SearchResultDTO, TransactionType } from "./types";

export interface TransactionFields {
  type: TransactionType;
  quantity: string;
  price: string;
  fee?: string;
  tradeDate: string;
}

export interface ValidateInput extends TransactionFields {
  instrument: SearchResultDTO | null;
}

type FieldsResult =
  { ok: true; value: TransactionFields } | { ok: false; errors: Record<string, string> };

type Result =
  { ok: true; value: CreateTransactionInput } | { ok: false; errors: Record<string, string> };

/** Null when `v` is a number above zero, else the message to show under the field.
 *  "Not a number" and "not above zero" read differently: a comma-grouped entry told
 *  it must be "positive" looks like Sage read it as negative. */
function positiveAmountError(v: string, what: string): string | null {
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n)) return `${what} must be a number, like 1.12 or 1,12.`;
  return n > 0 ? null : `${what} must be more than zero.`;
}

/** Validate the shared transaction fields (no instrument). Pure — no DOM/network. */
export function validateTransactionFields(input: TransactionFields): FieldsResult {
  const errors: Record<string, string> = {};

  if (input.type === "split") {
    const ratio = positiveAmountError(input.quantity, "Split ratio");
    if (ratio) errors.quantity = ratio;
    if (input.price !== "0") errors.price = "Price must be 0 for splits.";
  } else {
    const quantity = positiveAmountError(input.quantity, "Quantity");
    if (quantity) errors.quantity = quantity;
    const price = positiveAmountError(input.price, "Price");
    if (price) errors.price = price;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate)) errors.tradeDate = "Use a YYYY-MM-DD date.";

  const fee = input.fee ?? "";
  if (fee.trim() !== "") {
    const n = Number(fee);
    if (!Number.isFinite(n) || n < 0) errors.fee = "Fee must be zero or a positive number.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      type: input.type,
      quantity: input.quantity,
      price: input.price,
      tradeDate: input.tradeDate,
    },
  };
}

/** Validate add-transaction form fields, including the instrument. */
export function validateTransactionForm(input: ValidateInput): Result {
  const fields = validateTransactionFields(input);
  const errors: Record<string, string> = fields.ok ? {} : { ...fields.errors };
  if (!input.instrument) errors.instrument = "Choose an instrument.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      instrument: input.instrument as SearchResultDTO,
      type: input.type,
      quantity: input.quantity,
      price: input.price,
      tradeDate: input.tradeDate,
    },
  };
}
