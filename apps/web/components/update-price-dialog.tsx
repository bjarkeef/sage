"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Callout,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@sage/ui";
import { putPriceMark } from "../lib/api";
import { normalizeDecimalInput } from "../lib/decimal-input";
import { qk } from "../lib/query/keys";

/** Quick-action for custom holdings: record today's (or a backdated) price
 *  mark. Follows TransactionDialog's structure — a trigger button that opens
 *  a Dialog with the same field/button primitives. */
export function UpdatePriceDialog({ symbol, currency }: { symbol: string; currency: string }) {
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [price, setPrice] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => putPriceMark(symbol, { date, price: normalizeDecimalInput(price) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.portfolio() });
      void queryClient.invalidateQueries({ queryKey: qk.customHolding(symbol) });
      // Also refresh this asset page's own data — the brief's skeleton only
      // named portfolio/customHolding, but a price mark changes the quote,
      // chart and position value shown right where this dialog lives.
      void queryClient.invalidateQueries({ queryKey: qk.assetDetail(symbol) });
      void queryClient.invalidateQueries({ queryKey: ["asset-chart", symbol] });
      setOpen(false);
      setPrice("");
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not update the price.");
    },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (date.trim() === "" || price.trim() === "") return;
    setError(null);
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Update price
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update price</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="flex flex-wrap gap-3">
            <div>
              <Input
                aria-label="Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <Input
                aria-label="Price"
                inputMode="decimal"
                placeholder="Price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>

          {error && <Callout tone="error">{error}</Callout>}

          <div className="flex gap-2">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : `Set price (${currency})`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
