"use client";
import * as React from "react";
import {
  Input,
  SegmentedControl,
  Button,
  Callout,
  Field,
  FieldRow,
  DialogFooter,
  Stat,
} from "@sage/ui";
import { InstrumentPicker } from "./instrument-picker";
import { summarize } from "./transaction-summary";
import { formatMoney, formatDate } from "../lib/format";
import { validateTransactionForm, validateTransactionFields } from "../lib/validate-transaction";
import type { SearchResultDTO, TransactionType } from "../lib/types";

const typeOptions = [
  { label: "Buy", value: "buy" },
  { label: "Sell", value: "sell" },
  { label: "Dividend", value: "dividend" },
  { label: "Split", value: "split" },
];

export interface TransactionFormFields {
  type: TransactionType;
  quantity: string;
  price: string;
  fee: string;
  tradeDate: string;
}

export interface TransactionFormProps {
  mode: "add" | "edit";
  instrument: SearchResultDTO | null;
  /** Instrument fixed by the caller — the picker renders no search at all. */
  lockedInstrument?: boolean;
  onInstrumentChange?: (r: SearchResultDTO) => void;
  onInstrumentClear?: () => void;
  /** Add mode: a fetched market price to seed the price field when it's empty. */
  prefillPrice?: string | null;
  /** `QuoteDTO.asOf` for that price — the market's clock, not ours. */
  prefillAsOf?: string | null;
  /** Edit mode: existing values to prefill. */
  initial?: TransactionFormFields;
  submitting: boolean;
  formError: string | null;
  /** Resolves true when the save succeeded; only then does an add-another
   *  submit clear the amounts for the next entry. */
  onSubmit: (fields: TransactionFormFields, opts: { addAnother: boolean }) => Promise<boolean>;
  onCancel: () => void;
  /** Right-aligned link in the Holding label row. */
  holdingAction?: React.ReactNode;
}

export function TransactionForm({
  mode,
  instrument,
  lockedInstrument = false,
  onInstrumentChange,
  onInstrumentClear,
  prefillPrice,
  prefillAsOf,
  initial,
  submitting,
  formError,
  onSubmit,
  onCancel,
  holdingAction,
}: TransactionFormProps) {
  const [type, setType] = React.useState<TransactionType>(initial?.type ?? "buy");
  const [quantity, setQuantity] = React.useState(initial?.quantity ?? "");
  const [price, setPrice] = React.useState(initial?.price ?? "");
  const [fee, setFee] = React.useState(initial?.fee ?? "");
  const [tradeDate, setTradeDate] = React.useState(
    initial?.tradeDate ?? new Date().toISOString().slice(0, 10),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [lastSaved, setLastSaved] = React.useState<string | null>(null);
  const lastPrefill = React.useRef<string | null>(null);
  const quantityRef = React.useRef<HTMLInputElement>(null);

  // Seed the price from a fetched quote, but only into an empty field or one
  // still holding a value we applied ourselves — a price the user typed is
  // never clobbered. Runs when the quote arrives, not on every keystroke.
  React.useEffect(() => {
    if (!prefillPrice) {
      // A cleared prefill means the instrument changed. Drop a price *we*
      // applied; never a price the user typed.
      setPrice((cur) => (cur !== "" && cur === lastPrefill.current ? "" : cur));
      lastPrefill.current = null;
      return;
    }
    setPrice((cur) => (cur === "" || cur === lastPrefill.current ? prefillPrice : cur));
    lastPrefill.current = prefillPrice;
  }, [prefillPrice]);

  function handleTypeChange(value: string) {
    const t = value as TransactionType;
    setType(t);
    if (t === "split") setPrice("0");
    else if (price === "0") setPrice("");
    if (t === "dividend" || t === "split") setFee("");
    // A success receipt from the previous type must not linger beside a form
    // that now describes a different transaction.
    setLastSaved(null);
  }

  const isSplit = type === "split";
  const isDividend = type === "dividend";
  const showsFee = type === "buy" || type === "sell";
  const quantityLabel = isSplit ? "Ratio" : isDividend ? "Shares held" : "Quantity";
  const priceLabel = isDividend ? "Amount / share" : "Price / share";
  const currency = instrument?.currency ?? "";

  const summary = summarize({ type, quantity, price, fee });
  const summaryText = summary?.breakdown ?? null;
  const priceIsMarket = Boolean(prefillPrice) && price === lastPrefill.current && price !== "";

  async function submit(addAnother: boolean) {
    const effectivePrice = type === "split" ? "0" : price;
    const fields: TransactionFormFields = {
      type,
      quantity,
      price: effectivePrice,
      fee: showsFee ? fee : "",
      tradeDate,
    };
    const result =
      mode === "add"
        ? validateTransactionForm({ instrument, ...fields })
        : validateTransactionFields(fields);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});

    const saved = await onSubmit(fields, { addAnother });
    if (!saved) {
      // A stale "Saved …" receipt next to a fresh error callout reads as a
      // save that both succeeded and failed.
      setLastSaved(null);
      return;
    }
    if (!addAnother) return;

    // Keep instrument, type and date: the cases this serves are "three buys of
    // the same fund today" and "five holdings bought this morning".
    setLastSaved(
      `Saved ${instrument?.symbol ?? "transaction"}${summaryText ? ` · ${summaryText}` : ""}`,
    );
    setQuantity("");
    setPrice("");
    setFee("");
    lastPrefill.current = null;
    quantityRef.current?.focus();
  }

  return (
    <div className="space-y-4 pt-2">
      <SegmentedControl options={typeOptions} value={type} onChange={handleTypeChange} size="sm" />

      {mode === "add" ? (
        <Field
          label="Holding"
          // A picked instrument (search or locked) renders an identity row,
          // not a labelable control — a <label for> at that point would name
          // nothing, so the label degrades to a plain caption.
          htmlFor={instrument ? undefined : "txn-holding"}
          error={errors.instrument}
          action={holdingAction}
        >
          <InstrumentPicker
            id="txn-holding"
            instrument={instrument}
            locked={lockedInstrument}
            onSelect={(r) => onInstrumentChange?.(r)}
            onClear={() => onInstrumentClear?.()}
          />
        </Field>
      ) : (
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-medium">{instrument?.symbol}</span>
          <span className="truncate text-xs text-muted-foreground">{instrument?.name}</span>
        </div>
      )}

      <FieldRow>
        <Field label={quantityLabel} htmlFor="txn-quantity" error={errors.quantity}>
          <Input
            id="txn-quantity"
            ref={quantityRef}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Trade date" htmlFor="txn-date" error={errors.tradeDate}>
          <Input
            id="txn-date"
            type="date"
            value={tradeDate}
            onChange={(e) => setTradeDate(e.target.value)}
          />
        </Field>
      </FieldRow>

      {!isSplit && (
        <FieldRow>
          <Field
            label={priceLabel}
            htmlFor="txn-price"
            error={errors.price}
            hint={
              priceIsMarket && prefillAsOf
                ? `Market price · ${formatDate(prefillAsOf.slice(0, 10), { year: "always" })}`
                : undefined
            }
          >
            <div className="relative">
              <Input id="txn-price" value={price} onChange={(e) => setPrice(e.target.value)} />
              {currency && (
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                  {currency}
                </span>
              )}
            </div>
          </Field>
          {showsFee && (
            <Field label="Fee" htmlFor="txn-fee" error={errors.fee}>
              <div className="relative">
                <Input
                  id="txn-fee"
                  placeholder="Optional"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
                {currency && (
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                    {currency}
                  </span>
                )}
              </div>
            </Field>
          )}
        </FieldRow>
      )}

      {summary && (
        <div className="border-t border-hairline pt-3">
          <Stat
            size="sm"
            label={summary.label}
            value={
              summary.amount === null || !currency
                ? "—"
                : formatMoney({ amount: String(summary.amount), currency })
            }
            context={
              <span className="tabular-nums">{summary.breakdown ?? "Enter a quantity"}</span>
            }
          />
        </div>
      )}

      {formError && <Callout tone="error">{formError}</Callout>}
      {lastSaved && <p className="text-xs text-muted-foreground">{lastSaved}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <div className="flex gap-2">
          {mode === "add" && (
            <Button variant="secondary" onClick={() => void submit(true)} disabled={submitting}>
              Save and add another
            </Button>
          )}
          <Button onClick={() => void submit(false)} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}
