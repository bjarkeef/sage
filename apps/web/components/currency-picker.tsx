"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverTrigger, PopoverContent } from "@sage/ui";
import { updateDisplayCurrency } from "../lib/api";
import { invalidateFor } from "../lib/query/invalidation";

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "DKK", "SEK", "NOK", "CHF", "CAD", "AUD", "JPY"];

export function CurrencyPicker({ initialCurrency = null }: { initialCurrency?: string | null }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = React.useState<string | null>(initialCurrency);
  const [open, setOpen] = React.useState(false);

  async function handleSelect(currency: string | null) {
    const previous = current;
    setCurrent(currency);
    setOpen(false);
    try {
      await updateDisplayCurrency(currency);
      await invalidateFor(queryClient, "currency");
    } catch {
      // Save failed — the optimistic chip must not keep lying.
      setCurrent(previous);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-control border border-hairline px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {current ?? "Native"}
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-32 p-1">
        <button
          type="button"
          onClick={() => void handleSelect(null)}
          className={`w-full px-3 py-1.5 text-left text-xs hover:bg-accent ${current === null ? "font-medium text-foreground" : "text-muted-foreground"}`}
        >
          Native
        </button>
        {COMMON_CURRENCIES.map((ccy) => (
          <button
            key={ccy}
            type="button"
            onClick={() => void handleSelect(ccy)}
            className={`w-full px-3 py-1.5 text-left text-xs hover:bg-accent ${current === ccy ? "font-medium text-foreground" : "text-muted-foreground"}`}
          >
            {ccy}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
