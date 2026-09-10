import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";
import { qk } from "../lib/query/keys";
import { TransactionsList } from "./transactions-list";
import type { TransactionRow } from "../lib/types";

const fixtures: TransactionRow[] = [
  {
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
  },
  {
    id: "2",
    instrumentSymbol: "O",
    name: "Realty Income",
    type: "dividend",
    quantity: "52",
    price: "0.263",
    currency: "USD",
    fee: null,
    feeCurrency: null,
    tradeDate: "2026-07-02",
    source: null,
  },
];

vi.mock("../lib/api", () => ({
  listTransactions: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  deleteTransaction: vi.fn(),
  updateTransaction: vi.fn(),
}));
import * as api from "../lib/api";

beforeEach(() => vi.clearAllMocks());

/** Seed infinite-query cache shape used by TransactionsList. */
function renderSeeded(rows: TransactionRow[], opts?: { nextCursor?: string | null }) {
  const qc = makeTestQueryClient();
  qc.setQueryData(qk.transactions(), {
    pages: [{ items: rows, nextCursor: opts?.nextCursor ?? null }],
    pageParams: [undefined],
  });
  return renderWithClient(<TransactionsList />, qc);
}

describe("TransactionsList", () => {
  it("groups rows under month headers, newest month first", async () => {
    renderSeeded(fixtures);
    const months = await screen.findAllByTestId("txn-month");
    expect(months).toHaveLength(2);
    expect(months[0]!.textContent).toContain("July 2026");
    expect(months[1]!.textContent).toContain("June 2026");
  });

  it("gives dividend rows the income-tinted chip", async () => {
    renderSeeded(fixtures);
    const chip = await screen.findByText("dividend");
    expect(chip.className).toContain("bg-income");
    const buyChip = screen.getByText("buy");
    expect(buyChip.className).not.toContain("bg-income");
  });

  it("shows a currency total with the qty @ price detail underneath", async () => {
    renderSeeded(fixtures);
    expect(await screen.findByText("$1,500.00")).toBeInTheDocument();
    expect(await screen.findByText(/10 sh @ 150/)).toBeInTheDocument();
  });

  it("badges auto-added dividends and explains them on hover", async () => {
    renderSeeded([
      {
        id: "t-auto",
        instrumentSymbol: "KO",
        name: "Coca-Cola",
        type: "dividend",
        quantity: "100",
        price: "0.46",
        currency: "USD",
        fee: null,
        feeCurrency: null,
        tradeDate: "2026-03-15",
        source: "auto",
      },
      {
        id: "t-manual",
        instrumentSymbol: "KO",
        name: "Coca-Cola",
        type: "buy",
        quantity: "10",
        price: "60",
        currency: "USD",
        fee: null,
        feeCurrency: null,
        tradeDate: "2026-03-10",
        source: null,
      },
    ]);
    const badge = await screen.findByText("auto");
    expect(badge).toHaveAttribute(
      "title",
      "Added automatically from the dividend payment history. Delete to remove — it won't come back.",
    );
    expect(screen.getAllByText("auto")).toHaveLength(1); // manual row unbadged
  });

  it("loads the next server page when Load more is pressed", async () => {
    const page1: TransactionRow[] = Array.from({ length: 2 }, (_, i) => ({
      id: `p1-${i}`,
      instrumentSymbol: `A${i}`,
      name: `Co A${i}`,
      type: "buy" as const,
      quantity: "1",
      price: "100",
      currency: "USD",
      fee: null,
      feeCurrency: null,
      tradeDate: `2026-06-${String(10 + i).padStart(2, "0")}`,
      source: null,
    }));
    const page2: TransactionRow[] = [
      {
        id: "p2-0",
        instrumentSymbol: "B0",
        name: "Co B0",
        type: "buy",
        quantity: "1",
        price: "50",
        currency: "USD",
        fee: null,
        feeCurrency: null,
        tradeDate: "2026-05-01",
        source: null,
      },
    ];

    vi.mocked(api.listTransactions).mockResolvedValueOnce({
      items: page2,
      nextCursor: null,
    });

    renderSeeded(page1, { nextCursor: "cursor-page-2" });
    expect(await screen.findByText("A0")).toBeInTheDocument();
    expect(screen.queryByText("B0")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("B0")).toBeInTheDocument();
    expect(screen.getByText("A0")).toBeInTheDocument();
    expect(api.listTransactions).toHaveBeenCalledWith({
      limit: 50,
      cursor: "cursor-page-2",
    });
  });

  it("trims broker-precision quantities for display", async () => {
    renderSeeded([
      {
        id: "p1",
        instrumentSymbol: "VWCE",
        name: "Globix All-World",
        type: "dividend" as const,
        quantity: "2.3118999998786098398863788101336506",
        price: "0.82379",
        currency: "EUR",
        fee: null,
        feeCurrency: null,
        tradeDate: "2026-07-01",
        source: null,
      },
    ]);
    // formatQuantity caps at 4 decimal places (locked behavior, see
    // lib/format.test.ts), so the 5-decimal price fixture rounds to 0.8238
    // in the secondary line. The primary total uses the raw (untrimmed)
    // quantity × price, formatted as currency.
    expect(await screen.findByText("€1.90")).toBeInTheDocument();
    expect(await screen.findByText(/2\.3119 sh @ 0\.8238/)).toBeInTheDocument();
  });

  it("bands a five-figure share count while keeping the sub-cent price at full precision", async () => {
    renderSeeded([
      {
        id: "p2",
        instrumentSymbol: "VWCE",
        name: "Globix All-World",
        type: "dividend" as const,
        quantity: "41250.6633",
        price: "0.0521",
        currency: "EUR",
        fee: null,
        feeCurrency: null,
        tradeDate: "2026-07-05",
        source: null,
      },
    ]);
    // The share count is a five-figure quantity, so formatShares bands it to
    // 0 decimals ("41,251 sh"); the price beside it must stay on
    // formatQuantity at full precision, or a 5-cent price would render as
    // "0.05" instead of "0.0521".
    expect(await screen.findByText(/41,251 sh @ 0\.0521/)).toBeInTheDocument();
  });

  it("renders seeded cache data without refetching", async () => {
    const listSpy = vi.spyOn(api, "listTransactions");
    renderSeeded(fixtures);
    await screen.findAllByTestId("txn-month");
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("invalidates the transaction-family cache after a successful delete", async () => {
    vi.mocked(api.deleteTransaction).mockResolvedValueOnce(undefined);
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.transactions(), {
      pages: [{ items: fixtures, nextCursor: null }],
      pageParams: [undefined],
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderWithClient(<TransactionsList />, qc);

    await screen.findAllByTestId("txn-month");
    fireEvent.click(screen.getAllByLabelText("Delete transaction")[0]!);

    await waitFor(() => expect(api.deleteTransaction).toHaveBeenCalledWith("2"));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["transactions"] }));
  });

  it("confirms a delete by naming the row that went", async () => {
    // A row disappearing from a long list is easy to read as a mis-click, and
    // there is no undo — the confirmation is the only evidence of what left.
    vi.mocked(api.deleteTransaction).mockResolvedValueOnce(undefined);
    renderSeeded(fixtures);

    await screen.findAllByTestId("txn-month");
    // Rows sort newest-first, so the first delete button is the O dividend.
    fireEvent.click(screen.getAllByLabelText("Delete transaction")[0]!);

    expect(await screen.findByText("Transaction deleted")).toBeInTheDocument();
    expect(screen.getByText("Dividend from O")).toBeInTheDocument();
    // Not the gain tint: green is this app's colour for money going up, and
    // painting a deletion with it reads as though losing the row were good.
    expect(screen.getByText("Transaction deleted").closest("[role]")?.className).not.toContain(
      "gain",
    );
  });

  it("does not claim a delete that failed", async () => {
    vi.mocked(api.deleteTransaction).mockRejectedValueOnce(new Error("nope"));
    renderSeeded(fixtures);

    await screen.findAllByTestId("txn-month");
    fireEvent.click(screen.getAllByLabelText("Delete transaction")[0]!);

    expect(await screen.findByText("Could not delete the transaction.")).toBeInTheDocument();
    expect(screen.queryByText("Transaction deleted")).not.toBeInTheDocument();
  });

  it("invalidates the transaction-family cache after a successful edit", async () => {
    vi.mocked(api.updateTransaction).mockResolvedValueOnce(undefined);
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.transactions(), {
      pages: [{ items: fixtures, nextCursor: null }],
      pageParams: [undefined],
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderWithClient(<TransactionsList />, qc);

    await screen.findAllByTestId("txn-month");
    fireEvent.click(screen.getAllByLabelText("Edit transaction")[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.updateTransaction).toHaveBeenCalled());
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["transactions"] }));
  });
});
