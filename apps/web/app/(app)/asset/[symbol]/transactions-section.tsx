"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import {
  Button,
  Callout,
  Card,
  Chip,
  DataRow,
  EmptyState,
  RowCell,
  RowGrid,
  RowHeader,
  SectionHeader,
  useToast,
} from "@sage/ui";
import { listTransactions, deleteTransaction } from "../../../../lib/api";
import { qk } from "../../../../lib/query/keys";
import { invalidateFor } from "../../../../lib/query/invalidation";
import { formatDate, formatQuantity, formatShares } from "../../../../lib/format";
import { typeChipTone, totalLabel } from "../../../../lib/transaction-display";
import type { TransactionRow } from "../../../../lib/types";
import { RowsSkeleton } from "../../../../components/skeletons";
import { TransactionDialog } from "../../../../components/transaction-dialog";
import { describeSavedTransaction } from "../../../../components/transaction-summary";

/** Enough to cover a recent run of entries without turning the asset page into
 *  the ledger; the full history stays one click away on /transactions. */
const PREVIEW = 8;
const FETCH_LIMIT = 50;

/**
 * This holding's own ledger entries.
 *
 * The asset page is where a transaction is most often *entered* — from the "Add
 * transaction" button right above — so it also has to be where a mistake can be
 * seen and taken back. Without this, a mistyped quantity meant confirming the
 * toast, navigating to /transactions, and hunting for the row.
 */
export function TransactionsSection({
  symbol,
  held,
}: {
  symbol: string;
  /** Held (or a custom holding). Drives whether an empty ledger is worth a
   *  card at all — on an asset merely being browsed it is noise, but on one you
   *  hold it is a real state worth naming. */
  held: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: qk.symbolTransactions(symbol),
    queryFn: () => listTransactions({ symbol, limit: FETCH_LIMIT }),
  });

  const rows = React.useMemo(() => {
    const items = data?.items ?? [];
    return [...items].sort(
      (a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.id.localeCompare(a.id),
    );
  }, [data]);

  const editingRow = React.useMemo(
    () => rows.find((r) => r.id === editingId) ?? null,
    [rows, editingId],
  );

  async function remove(row: TransactionRow) {
    setError(null);
    try {
      await deleteTransaction(row.id);
      await invalidateFor(queryClient, "transaction");
      toast({
        title: "Transaction deleted",
        description: describeSavedTransaction({
          type: row.type,
          quantity: row.quantity,
          symbol: row.instrumentSymbol,
        }),
      });
    } catch {
      setError("Could not delete the transaction.");
    }
  }

  if (isLoading) {
    if (!held) return null;
    return (
      <section className="mb-10">
        <SectionHeader title="Transactions" />
        <Card>
          <RowsSkeleton rows={3} />
        </Card>
      </section>
    );
  }

  // A sold-out position still has a history worth reading, so rows win over
  // `held`; only a browsed asset with nothing recorded drops the section.
  if (rows.length === 0 && !held) return null;

  const visible = showAll ? rows : rows.slice(0, PREVIEW);

  return (
    <section className="mb-10">
      <SectionHeader
        title="Transactions"
        meta={
          rows.length > 0 ? (
            <Link href="/transactions" className="hover:text-foreground">
              {rows.length === 1 ? "1 entry" : `${rows.length} entries`} · full ledger
            </Link>
          ) : undefined
        }
      />
      <Card>
        {error && (
          <Callout tone="error" className="mb-3">
            {error}
          </Callout>
        )}
        {rows.length === 0 ? (
          <EmptyState message={`No transactions recorded for ${symbol} yet.`} />
        ) : (
          <>
            <RowGrid columns="110px 100px minmax(0,1fr) 72px">
              <RowHeader cells={["Date", "Type", "Amount", ""]} align={["left", "left", "right"]} />
              {visible.map((r) => (
                <DataRow key={r.id} className="group">
                  <RowCell variant="text" primary={formatDate(r.tradeDate, { year: "always" })} />
                  <RowCell
                    variant="text"
                    primary={
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
                    }
                  />
                  <RowCell
                    align="right"
                    primary={
                      r.type === "split" ? `${formatQuantity(r.quantity)} : 1` : totalLabel(r)
                    }
                    secondary={
                      r.type === "split"
                        ? "split ratio"
                        : `${formatShares(r.quantity)} sh @ ${formatQuantity(r.price)}`
                    }
                  />
                  <div
                    role="cell"
                    className="flex justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${r.type} of ${r.instrumentSymbol}`}
                      onClick={() => setEditingId(r.id)}
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${r.type} of ${r.instrumentSymbol}`}
                      onClick={() => void remove(r)}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </Button>
                  </div>
                </DataRow>
              ))}
            </RowGrid>
            {rows.length > PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 px-3 text-xs text-muted-foreground hover:text-foreground"
              >
                {showAll ? "Show less" : `Show all ${rows.length}`}
              </button>
            )}
          </>
        )}
      </Card>
      {editingRow && (
        <TransactionDialog
          mode="edit"
          row={editingRow}
          open
          onOpenChange={(next) => !next && setEditingId(null)}
        />
      )}
    </section>
  );
}
