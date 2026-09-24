"use client";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import {
  Button,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@sage/ui";
import { TransactionForm, type TransactionFormFields } from "./transaction-form";
import { describeSavedTransaction } from "./transaction-summary";
import { createTransaction, updateTransaction, getInstrumentQuote } from "../lib/api";
import { invalidateFor } from "../lib/query/invalidation";
import type { SearchResultDTO, TransactionRow } from "../lib/types";
import { cleanQuotePrice } from "../lib/quote-price";

type Props =
  | {
      mode: "add";
      /** Fixed instrument — renders no search, and the trigger label
       *  changes to "Add transaction". */
      instrument?: SearchResultDTO;
      triggerLabel?: string;
      /** Trigger styling, so a page can fit the button to its own toolbar
       *  (defaults to the standalone primary CTA). */
      triggerVariant?: "default" | "secondary" | "outline" | "ghost";
      triggerSize?: "default" | "sm";
      /** Render the trigger as an icon-only button (holdings rows). */
      triggerIconOnly?: boolean;
    }
  | { mode: "edit"; row: TransactionRow; open: boolean; onOpenChange: (open: boolean) => void };

/** Synthesize the instrument shape the form needs (symbol/name/currency) from a
 *  stored row. Edit mode never re-submits the instrument, so exchange/assetType
 *  are display-irrelevant placeholders. */
function instrumentFromRow(row: TransactionRow): SearchResultDTO {
  return {
    symbol: row.instrumentSymbol,
    name: row.name,
    exchange: "",
    currency: row.currency,
    assetType: "other",
  };
}

export function TransactionDialog(props: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Access edit-only props (row/open/onOpenChange) only behind a
  // `props.mode === "edit"` check — TypeScript narrows the discriminated union
  // through that check directly, not through a `const isEdit` alias.
  const [addOpen, setAddOpen] = React.useState(false);
  const open = props.mode === "edit" ? props.open : addOpen;

  const fixedInstrument = props.mode === "add" ? props.instrument : undefined;

  const [instrument, setInstrument] = React.useState<SearchResultDTO | null>(
    props.mode === "edit" ? instrumentFromRow(props.row) : (fixedInstrument ?? null),
  );
  const [prefillPrice, setPrefillPrice] = React.useState<string | null>(null);
  const [prefillAsOf, setPrefillAsOf] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (props.mode === "edit") props.onOpenChange(next);
    else setAddOpen(next);
    if (!next) {
      setFormError(null);
      if (props.mode === "add") {
        setInstrument(fixedInstrument ?? null);
        setPrefillPrice(null);
        setPrefillAsOf(null);
      }
    }
  }

  // Fetch the quote for a fixed instrument as soon as the dialog opens, so a
  // locked dialog (opened from an asset page) arrives with its price already
  // filled instead of waiting for a search selection that never happens.
  React.useEffect(() => {
    if (!open || !fixedInstrument) return;
    // Resync on open, not only on close: `instrument` is seeded once at
    // mount, so a live instance whose `instrument` prop changed before its
    // first open would otherwise display and submit the stale value while
    // this effect (and the trigger's aria-label) already read the fresh prop.
    setInstrument(fixedInstrument);
    let cancelled = false;
    void getInstrumentQuote(fixedInstrument.symbol).then((quote) => {
      if (cancelled || !quote) return;
      setPrefillPrice(cleanQuotePrice(quote.price.amount));
      setPrefillAsOf(quote.asOf);
    });
    return () => {
      cancelled = true;
    };
  }, [open, fixedInstrument]);

  // Monotonic id rather than a per-call `cancelled` flag: this is an event
  // handler, not an effect, so there's no cleanup function to close over one.
  // An id survives re-entrancy cleanly too — picking the same symbol again
  // while an earlier request for it is still in flight is still "current"
  // for the request that's actually resolving last, which a same-symbol
  // identity check would get wrong.
  const instrumentRequestId = React.useRef(0);

  async function handleInstrumentChange(r: SearchResultDTO) {
    setInstrument(r);
    setPrefillPrice(null);
    setPrefillAsOf(null);
    const requestId = ++instrumentRequestId.current;
    const quote = await getInstrumentQuote(r.symbol);
    // Discard a quote that resolves after the user has already moved on to a
    // different instrument — otherwise it lands on the new selection wearing
    // the "Market price" caption as if it were authoritative for it.
    if (quote && requestId === instrumentRequestId.current) {
      setPrefillPrice(cleanQuotePrice(quote.price.amount));
      setPrefillAsOf(quote.asOf);
    }
  }

  async function handleSubmit(
    fields: TransactionFormFields,
    opts: { addAnother: boolean },
  ): Promise<boolean> {
    setSubmitting(true);
    setFormError(null);
    try {
      const feeTrimmed = fields.fee.trim();
      const feeFields =
        feeTrimmed !== "" ? { fee: feeTrimmed, feeCurrency: instrument?.currency } : {};
      // The confirmation names what was written, not just that something was.
      // With add-another the dialog stays open and the form clears, so "added"
      // on its own leaves no evidence of which entry actually landed.
      if (props.mode === "add") {
        if (!instrument) return false;
        await createTransaction({
          instrument,
          type: fields.type,
          quantity: fields.quantity,
          price: fields.price,
          tradeDate: fields.tradeDate,
          ...feeFields,
        });
        toast({
          title: "Transaction added",
          description: describeSavedTransaction({
            type: fields.type,
            quantity: fields.quantity,
            symbol: instrument.symbol,
          }),
        });
      } else {
        await updateTransaction(props.row.id, {
          type: fields.type,
          quantity: fields.quantity,
          price: fields.price,
          tradeDate: fields.tradeDate,
          ...feeFields,
        });
        toast({
          title: "Transaction updated",
          description: describeSavedTransaction({
            type: fields.type,
            quantity: fields.quantity,
            symbol: props.row.instrumentSymbol,
          }),
        });
      }
      // Add-another keeps the dialog up; the form clears its own amounts.
      if (!opts.addAnother) handleOpenChange(false);
      await invalidateFor(queryClient, "transaction");
      return true;
    } catch (err) {
      // Failures stay inline in the form, next to the fields that have to
      // change — a toast would pull the explanation away from the fix, and
      // reporting it in both places just makes the user read it twice.
      setFormError(err instanceof Error ? err.message : "Could not save the transaction.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  const initial: TransactionFormFields | undefined =
    props.mode === "edit"
      ? {
          type: props.row.type,
          quantity: props.row.quantity,
          price: props.row.price,
          fee: props.row.fee ?? "",
          tradeDate: props.row.tradeDate,
        }
      : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.mode === "add" && (
        <DialogTrigger asChild>
          <Button
            variant={props.triggerVariant}
            size={props.triggerSize}
            aria-label={
              props.triggerIconOnly
                ? `Add transaction for ${fixedInstrument?.symbol ?? ""}`
                : undefined
            }
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {!props.triggerIconOnly && (props.triggerLabel ?? "Add transaction")}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {props.mode === "edit" ? "Edit transaction" : "Add transaction"}
          </DialogTitle>
        </DialogHeader>
        <TransactionForm
          mode={props.mode}
          instrument={instrument}
          lockedInstrument={Boolean(fixedInstrument)}
          onInstrumentChange={(r) => void handleInstrumentChange(r)}
          onInstrumentClear={() => {
            setInstrument(null);
            setPrefillPrice(null);
            setPrefillAsOf(null);
          }}
          prefillPrice={prefillPrice}
          prefillAsOf={prefillAsOf}
          initial={initial}
          submitting={submitting}
          formError={formError}
          holdingAction={
            fixedInstrument ? undefined : (
              <Link href="/custom-holding/new" className="text-xs text-muted-foreground underline">
                or add a custom holding
              </Link>
            )
          }
          onSubmit={handleSubmit}
          onCancel={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
