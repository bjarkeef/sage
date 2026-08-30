import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithClient } from "../../../../lib/test/render-with-client";
import { qk } from "../../../../lib/query/keys";
import { TransactionsSection } from "./transactions-section";
import type { TransactionRow } from "../../../../lib/types";

vi.mock("../../../../lib/api", () => ({
  listTransactions: vi.fn(),
  deleteTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  createTransaction: vi.fn(),
  getInstrumentQuote: vi.fn().mockResolvedValue(null),
}));
import * as api from "../../../../lib/api";

function row(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: "1",
    instrumentSymbol: "AAPL",
    name: "Apple Inc.",
    type: "buy",
    quantity: "10",
    price: "150",
    currency: "USD",
    fee: null,
    feeCurrency: null,
    tradeDate: "2026-06-14",
    source: null,
    ...overrides,
  };
}

function seed(rows: TransactionRow[]) {
  vi.mocked(api.listTransactions).mockResolvedValue({ items: rows, nextCursor: null });
}

beforeEach(() => vi.clearAllMocks());

describe("TransactionsSection", () => {
  it("asks the API for only this holding's entries", async () => {
    // Not a client-side filter over the whole ledger: on a large portfolio that
    // would pull thousands of rows to show eight.
    seed([row()]);
    renderWithClient(<TransactionsSection symbol="AAPL" held />);
    await waitFor(() =>
      expect(api.listTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: "AAPL" }),
      ),
    );
  });

  it("lists entries newest first", async () => {
    seed([
      row({ id: "old", tradeDate: "2026-01-05", price: "100" }),
      row({ id: "new", tradeDate: "2026-06-14", price: "150" }),
    ]);
    renderWithClient(<TransactionsSection symbol="AAPL" held />);
    const dates = (await screen.findAllByRole("row"))
      .map((r) => r.textContent ?? "")
      .filter((t) => t.includes("2026"));
    expect(dates[0]).toContain("Jun 14, 2026");
    expect(dates[1]).toContain("Jan 5, 2026");
  });

  it("deletes an entry from the asset page and confirms it", async () => {
    // The whole point of the section: the transaction is entered here, so a
    // mistake has to be undoable here rather than on /transactions.
    seed([row()]);
    vi.mocked(api.deleteTransaction).mockResolvedValueOnce(undefined);
    renderWithClient(<TransactionsSection symbol="AAPL" held />);

    fireEvent.click(await screen.findByRole("button", { name: /Delete buy of AAPL/ }));

    await waitFor(() => expect(api.deleteTransaction).toHaveBeenCalledWith("1"));
    expect(await screen.findByText("Transaction deleted")).toBeInTheDocument();
  });

  it("reports a failed delete inline and keeps the row", async () => {
    seed([row()]);
    vi.mocked(api.deleteTransaction).mockRejectedValueOnce(new Error("nope"));
    renderWithClient(<TransactionsSection symbol="AAPL" held />);

    fireEvent.click(await screen.findByRole("button", { name: /Delete buy of AAPL/ }));

    expect(await screen.findByText("Could not delete the transaction.")).toBeInTheDocument();
    expect(screen.queryByText("Transaction deleted")).not.toBeInTheDocument();
  });

  it("opens the edit dialog for a row", async () => {
    seed([row()]);
    renderWithClient(<TransactionsSection symbol="AAPL" held />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit buy of AAPL/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("says so when a held asset has no entries", async () => {
    seed([]);
    renderWithClient(<TransactionsSection symbol="AAPL" held />);
    expect(await screen.findByText(/No transactions recorded for AAPL/)).toBeInTheDocument();
  });

  it("renders nothing on an asset that is merely being browsed", async () => {
    // An empty card under every unheld asset is noise, not information.
    seed([]);
    const { container, queryClient } = renderWithClient(
      <TransactionsSection symbol="AAPL" held={false} />,
    );
    // Wait for the query to SETTLE, not merely to have been issued: while it is
    // still loading this component renders nothing anyway, so asserting too
    // early passes whether or not the empty-and-unheld guard exists.
    await waitFor(() =>
      expect(queryClient.getQueryData(qk.symbolTransactions("AAPL"))).toBeDefined(),
    );
    expect(screen.queryByText("Transactions")).not.toBeInTheDocument();
    expect(container.querySelector("section")).toBeNull();
  });

  it("still shows the history of a position that has been sold out", async () => {
    // held=false but rows exist: the ledger outlives the position, and hiding
    // it would strand the entries somewhere the user cannot reach them.
    seed([row({ type: "sell" })]);
    renderWithClient(<TransactionsSection symbol="AAPL" held={false} />);
    expect(await screen.findByText("Transactions")).toBeInTheDocument();
  });

  it("collapses a long history behind a toggle", async () => {
    seed(
      Array.from({ length: 12 }, (_, i) => row({ id: String(i), tradeDate: `2026-06-${i + 1}` })),
    );
    renderWithClient(<TransactionsSection symbol="AAPL" held />);

    const toggle = await screen.findByRole("button", { name: "Show all 12" });
    expect(screen.getAllByRole("button", { name: /Delete buy of AAPL/ })).toHaveLength(8);
    fireEvent.click(toggle);
    expect(screen.getAllByRole("button", { name: /Delete buy of AAPL/ })).toHaveLength(12);
  });
});
