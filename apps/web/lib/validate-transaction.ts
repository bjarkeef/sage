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

function isPositiveDecimal(v: string): boolean {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) && n > 0;
}

/** Validate the shared transaction fields (no instrument). Pure — no DOM/network. */
export function validateTransactionFields(input: TransactionFields): FieldsResult {
  const errors: Record<string, string> = {};

  if (input.type === "split") {
    if (!isPositiveDecimal(input.quantity))
      errors.quantity = "Split ratio must be a positive number.";
    if (input.price !== "0") errors.price = "Price must be 0 for splits.";
  } else {
    if (!isPositiveDecimal(input.quantity)) errors.quantity = "Quantity must be a positive number.";
    if (!isPositiveDecimal(input.price)) errors.price = "Price must be a positive number.";
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
