"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button, Popover, PopoverTrigger, PopoverContent } from "@sage/ui";
import { removeHolding } from "../lib/api";
import { invalidateFor } from "../lib/query/invalidation";

/** Labelled "Remove holding" action for the asset page. Unlike the row-track
 *  icon it replaces, it spells out that removal wipes the whole ledger, and on
 *  success it leaves the (now non-existent) asset page for /holdings. */
export function RemoveHoldingButton({ symbol }: { symbol: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeHolding(symbol);
      setOpen(false);
      await invalidateFor(queryClient, "holdings");
      router.push("/holdings");
    } catch {
      setError("Could not remove the holding.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-loss">
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          Remove holding
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        {error ? (
          <p className="mb-2 text-xs text-loss">{error}</p>
        ) : (
          <p className="mb-2 text-sm text-muted-foreground">
            Remove <span className="font-medium text-foreground">{symbol}</span>? This deletes all
            transactions for it and can&rsquo;t be undone.
          </p>
        )}
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>
            {busy ? "Removing…" : error ? "Retry" : "Remove"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
