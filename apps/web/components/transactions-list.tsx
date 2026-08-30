"use client";
import * as React from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { Button, Chip, RowCell, EmptyState, Callout, useToast } from "@sage/ui";
import { listTransactions, deleteTransaction } from "../lib/api";
import { qk } from "../lib/query/keys";
import { invalidateFor } from "../lib/query/invalidation";
import type { TransactionRow } from "../lib/types";
import { RowsSkeleton } from "./skeletons";
import { formatQuantity } from "../lib/format";
import { typeChipTone, totalLabel } from "../lib/transaction-display";
import { TransactionDialog } from "./transaction-dialog";
import { describeSavedTransaction } from "./transaction-summary";

const PAGE_SIZE = 50;

function monthKey(tradeDate: string): string {
  return tradeDate.slice(0, 7);
}

function monthLabel(key: string): string {
  return new Date(`${key}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function dayLabel(tradeDate: string): string {
  return new Date(`${tradeDate}T00:00:00`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

export function TransactionsList() {
  const queryClient = useQueryClient();
  const {
    data,
    isLoading: loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: qk.transactions(),
    queryFn: ({ pageParam }) => listTransactions({ limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const [error, setError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const { toast } = useToast();

  const rows = React.useMemo(() => {
    const flat = data?.pages.flatMap((p) => p.items) ?? [];
    // API pages are desc, but flatten order is still newest-first; re-sort for
    // safety when pages are appended or cache is seeded out of order.
    return [...flat].sort(
      (a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.id.localeCompare(a.id),
    );
  }, [data]);

  async function remove(row: TransactionRow) {
    setError(null);
    try {
      await deleteTransaction(row.id);
      await invalidateFor(queryClient, "transaction");
      // The row vanishes from a long list, which on its own is easy to mistake
      // for a mis-click or a filter — the confirmation names what went.
      toast({
        title: "Transaction deleted",
        description: describeSavedTransaction({
          type: row.type,
          quantity: row.quantity,
          symbol: row.instrumentSymbol,
        }),
      });
    } catch {
      // Failure stays inline: the row is still there to retry on.
      setError("Could not delete the transaction.");
    }
  }

  const groups = React.useMemo(() => {
    const byMonth = new Map<string, TransactionRow[]>();
    for (const r of rows) {
      const key = monthKey(r.tradeDate);
      const list = byMonth.get(key) ?? [];
      list.push(r);
      byMonth.set(key, list);
    }
    // Newest month first (keys encounter order follows sorted rows).
    return [...byMonth.entries()].map(([key, list]) => ({
      key,
      label: monthLabel(key),
      rows: list,
    }));
  }, [rows]);

  const editingRow = React.useMemo(
    () => rows.find((r) => r.id === editingId) ?? null,
    [rows, editingId],
  );

  if (loading) return <RowsSkeleton rows={4} />;
  if (rows.length === 0) return <EmptyState message="No transactions yet." />;

  return (
    <div>
      {error && (
        <Callout tone="error" className="mb-3">
          {error}
        </Callout>
      )}
      {groups.map((group) => (
        <section key={group.key} className="mb-6">
          <div
            data-testid="txn-month"
            className="flex items-baseline justify-between border-b border-hairline px-3 pb-2"
          >
            <span className="label-caps text-muted-foreground">{group.label}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {group.rows.length} {group.rows.length === 1 ? "transaction" : "transactions"}
            </span>
          </div>
          <div className="mt-1 space-y-0.5">
            {group.rows.map((r) => (
              <div
                key={r.id}
                className="group grid grid-cols-[64px_auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-control px-3 py-2 transition-colors hover:bg-surface-hover"
              >
                <span className="text-xs text-muted-foreground">{dayLabel(r.tradeDate)}</span>
                <span className="flex items-center gap-1">
                  <Chip tone={typeChipTone[r.type]}>{r.type}</Chip>
                  {r.source === "auto" && (
                    <Chip
                      variant="outline"
                      className="lowercase tracking-normal"
                      title="Added automatically from the dividend payment history. Delete to remove — it won't come back."
                    >
                      auto
                    </Chip>
                  )}
                </span>
                <span className="min-w-0 truncate">
                  <span className="text-sm font-medium">{r.instrumentSymbol}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{r.name}</span>
                </span>
                <RowCell
                  role="none"
                  align="right"
                  primary={r.type === "split" ? `${formatQuantity(r.quantity)} : 1` : totalLabel(r)}
                  secondary={
                    r.type === "split"
                      ? "split ratio"
                      : `${formatQuantity(r.quantity)} sh @ ${formatQuantity(r.price)}`
                  }
                />
                <span className="flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit transaction"
                    onClick={() => setEditingId(r.id)}
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete transaction"
                    onClick={() => void remove(r)}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
      {editingRow && (
        <TransactionDialog
          mode="edit"
          row={editingRow}
          open
          onOpenChange={(o) => {
            if (!o) setEditingId(null);
          }}
        />
      )}
    </div>
  );
}
