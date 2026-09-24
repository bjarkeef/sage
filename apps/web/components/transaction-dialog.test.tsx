import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";

vi.mock("./instrument-search", () => ({
  InstrumentSearch: ({ onSelect }: { onSelect: (r: unknown) => void }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onSelect({
            symbol: "AAPL",
            name: "Apple Inc",
            exchange: "XNAS",
            currency: "USD",
            assetType: "stock",
          })
        }
      >
        pick AAPL
      </button>
      {/* Second option so a test can exercise an instrument switch — the
          dialog's own price-clearing seam (findings 1 and 4) is only
          reachable by actually picking two different instruments in turn. */}
      <button
        type="button"
        onClick={() =>
          onSelect({
            symbol: "MSFT",
            name: "Microsoft Corp",
            exchange: "XNAS",
            currency: "USD",
            assetType: "stock",
          })
        }
      >
        pick MSFT
      </button>
    </div>
  ),
}));

// Flag for one test (see "switches instruments without an intervening
// Change") that needs InstrumentPicker's identity-view gate bypassed: real
// InstrumentPicker only re-renders InstrumentSearch after `onClear`, which
// itself already resets prefillPrice/prefillAsOf — so going through it can
// never exercise handleInstrumentChange's OWN clear with a non-null prior
// value. Bypassing lets that one test invoke onSelect twice in a row, in
// isolation from InstrumentPicker's gating (covered separately by
// instrument-picker.test.tsx).
const pickerMode = vi.hoisted(() => ({ bypassGate: false }));

vi.mock("./instrument-picker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./instrument-picker")>();
  const { InstrumentSearch } = await import("./instrument-search");
  return {
    InstrumentPicker: (props: { onSelect?: (r: unknown) => void; [key: string]: unknown }) =>
      pickerMode.bypassGate ? (
        <InstrumentSearch onSelect={(r: unknown) => props.onSelect?.(r)} />
      ) : (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <actual.InstrumentPicker {...(props as any)} />
      ),
  };
});

import * as api from "../lib/api";
vi.mock("../lib/api", () => ({
  createTransaction: vi.fn().mockResolvedValue({ id: "new" }),
  updateTransaction: vi.fn().mockResolvedValue(undefined),
  getInstrumentQuote: vi.fn(),
}));

import { TransactionDialog } from "./transaction-dialog";
import type { TransactionRow } from "../lib/types";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getInstrumentQuote).mockResolvedValue(null);
  pickerMode.bypassGate = false;
});

const AAPL = {
  symbol: "AAPL",
  name: "Apple Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock" as const,
};

const row: TransactionRow = {
  id: "t1",
  instrumentSymbol: "AAPL",
  name: "Apple Inc",
  type: "buy",
  quantity: "10",
  price: "100",
  currency: "USD",
  fee: "1.50",
  feeCurrency: "USD",
  tradeDate: "2026-01-01",
  source: null,
};

describe("TransactionDialog add mode", () => {
  it("seeds an empty price from the fetched quote", async () => {
    vi.mocked(api.getInstrumentQuote).mockResolvedValueOnce({
      price: { amount: "150.00", currency: "USD" },
      asOf: "2026-07-15",
    });
    renderWithClient(<TransactionDialog mode="add" />, makeTestQueryClient());
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(await screen.findByText("pick AAPL"));
    await waitFor(() => expect(screen.getByLabelText("Price / share")).toHaveValue("150.00"));
  });

  it("seeds the price as quoted, without float widening noise", async () => {
    vi.mocked(api.getInstrumentQuote).mockResolvedValueOnce({
      price: { amount: "496.2699890136719", currency: "USD" },
      asOf: "2026-07-15",
    });
    renderWithClient(<TransactionDialog mode="add" />, makeTestQueryClient());
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(await screen.findByText("pick AAPL"));
    await waitFor(() => expect(screen.getByLabelText("Price / share")).toHaveValue("496.27"));
  });

  it("leaves the price empty and shows no error when the quote is unavailable", async () => {
    vi.mocked(api.getInstrumentQuote).mockResolvedValueOnce(null);
    renderWithClient(<TransactionDialog mode="add" />, makeTestQueryClient());
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(await screen.findByText("pick AAPL"));
    await waitFor(() => expect(api.getInstrumentQuote).toHaveBeenCalledWith("AAPL"));
    expect(screen.getByLabelText("Price / share")).toHaveValue("");
  });

  it("clears a stale price when switching to an instrument whose quote fails", async () => {
    // Regression this guards: TransactionForm's price-seeding effect used to
    // early-return on a falsy prefillPrice, so it never cleared a price it
    // had already applied for the *previous* instrument. Picking AAPL (which
    // quotes), then switching to MSFT (which doesn't), used to leave AAPL's
    // 150.00 sitting in the field under the MSFT identity — an MSFT buy saved
    // at AAPL's price. This also exercises the dialog's own clearing of
    // prefillPrice/prefillAsOf in handleInstrumentChange: without it, the
    // stale value would never even get a chance to be cleared.
    vi.mocked(api.getInstrumentQuote)
      .mockResolvedValueOnce({ price: { amount: "150.00", currency: "USD" }, asOf: "2026-07-15" })
      .mockResolvedValueOnce(null);
    renderWithClient(<TransactionDialog mode="add" />, makeTestQueryClient());
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(await screen.findByText("pick AAPL"));
    await waitFor(() => expect(screen.getByLabelText("Price / share")).toHaveValue("150.00"));

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(await screen.findByText("pick MSFT"));

    await waitFor(() => expect(api.getInstrumentQuote).toHaveBeenCalledWith("MSFT"));
    expect(screen.getByLabelText("Price / share")).toHaveValue("");
  });

  it("clears its own prefillPrice/prefillAsOf the moment it switches instruments", async () => {
    // Isolates the dialog's OWN responsibility (handleInstrumentChange,
    // transaction-dialog.tsx:89-98) from InstrumentPicker's Change-button
    // gating covered above: with the gate bypassed, MSFT is picked directly
    // while prefillPrice still holds AAPL's "150.00" — the one flow that can
    // tell handleInstrumentChange's own clear apart from onInstrumentClear's.
    pickerMode.bypassGate = true;
    vi.mocked(api.getInstrumentQuote)
      .mockResolvedValueOnce({ price: { amount: "150.00", currency: "USD" }, asOf: "2026-07-15" })
      .mockResolvedValueOnce(null);
    renderWithClient(<TransactionDialog mode="add" />, makeTestQueryClient());
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(await screen.findByText("pick AAPL"));
    await waitFor(() => expect(screen.getByLabelText("Price / share")).toHaveValue("150.00"));

    fireEvent.click(screen.getByText("pick MSFT"));

    await waitFor(() => expect(api.getInstrumentQuote).toHaveBeenCalledWith("MSFT"));
    expect(screen.getByLabelText("Price / share")).toHaveValue("");
  });

  it("discards a slow quote that resolves after the instrument has moved on", async () => {
    // Reproduces the race: AAPL's quote is left in flight, the user switches
    // to MSFT (whose quote resolves null, correctly emptying the field), and
    // only then does AAPL's slow quote land. Without a cancellation guard in
    // handleInstrumentChange, that stale resolution overwrites
    // prefillPrice/prefillAsOf for the instrument now showing — MSFT rendered
    // with AAPL's price, wearing the "Market price" caption as if it were
    // authoritative.
    let resolveAAPL!: (
      value: { price: { amount: string; currency: string }; asOf: string } | null,
    ) => void;
    const aaplQuote = new Promise<{
      price: { amount: string; currency: string };
      asOf: string;
    } | null>((resolve) => {
      resolveAAPL = resolve;
    });
    vi.mocked(api.getInstrumentQuote).mockImplementation((symbol: string) =>
      symbol === "AAPL" ? aaplQuote : Promise.resolve(null),
    );

    renderWithClient(<TransactionDialog mode="add" />, makeTestQueryClient());
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(await screen.findByText("pick AAPL"));
    await waitFor(() => expect(api.getInstrumentQuote).toHaveBeenCalledWith("AAPL"));

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(await screen.findByText("pick MSFT"));
    await waitFor(() => expect(api.getInstrumentQuote).toHaveBeenCalledWith("MSFT"));
    expect(screen.getByLabelText("Price / share")).toHaveValue("");

    // AAPL's quote finally lands, after MSFT is the current selection. A
    // macrotask boundary (not just an awaited microtask) guarantees every
    // microtask the resolved promise's continuation schedules — including
    // React's own state-update processing — has drained before we assert,
    // regardless of the bug being present or fixed.
    resolveAAPL({ price: { amount: "150.00", currency: "USD" }, asOf: "2020-01-02" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByLabelText("Price / share")).toHaveValue("");
    expect(screen.queryByText(/Market price/)).not.toBeInTheDocument();
  });

  it("creates the transaction with fee and feeCurrency on save", async () => {
    vi.mocked(api.getInstrumentQuote).mockResolvedValueOnce(null);
    renderWithClient(<TransactionDialog mode="add" />, makeTestQueryClient());
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(await screen.findByText("pick AAPL"));

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Price / share"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Fee"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          instrument: expect.objectContaining({ symbol: "AAPL", currency: "USD" }) as unknown,
          type: "buy",
          quantity: "5",
          price: "100",
          fee: "2",
          feeCurrency: "USD",
        }),
      ),
    );
  });

  it("confirms a save by naming what was written", async () => {
    // Without this the save was completely silent: the dialog shut and the
    // user was left to go hunting through the ledger to find out whether
    // anything happened at all.
    vi.mocked(api.getInstrumentQuote).mockResolvedValueOnce(null);
    renderWithClient(<TransactionDialog mode="add" />, makeTestQueryClient());
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(await screen.findByText("pick AAPL"));

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Price / share"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Transaction added")).toBeInTheDocument();
    expect(screen.getByText("Bought 5 AAPL")).toBeInTheDocument();
  });

  it("does not claim success when the save failed", async () => {
    // The confirmation has to sit after the awaited write, not beside it.
    vi.mocked(api.getInstrumentQuote).mockResolvedValueOnce(null);
    vi.mocked(api.createTransaction).mockRejectedValueOnce(new Error("Nope."));
    renderWithClient(<TransactionDialog mode="add" />, makeTestQueryClient());
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(await screen.findByText("pick AAPL"));

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Price / share"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Nope.")).toBeInTheDocument();
    expect(screen.queryByText("Transaction added")).not.toBeInTheDocument();
  });

  it("drops a whitespace-only fee instead of sending it to the API", async () => {
    vi.mocked(api.getInstrumentQuote).mockResolvedValueOnce(null);
    renderWithClient(<TransactionDialog mode="add" />, makeTestQueryClient());
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.click(await screen.findByText("pick AAPL"));

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Price / share"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Fee"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.createTransaction).toHaveBeenCalledWith(
        expect.not.objectContaining({ fee: expect.anything() as unknown }),
      ),
    );
    expect(api.createTransaction).toHaveBeenCalledWith(
      expect.not.objectContaining({ feeCurrency: expect.anything() as unknown }),
    );
  });

  it("opens with the instrument fixed and no search when given one", async () => {
    renderWithClient(<TransactionDialog mode="add" instrument={AAPL} />);
    await userEvent.click(screen.getByRole("button", { name: /Add transaction/ }));
    expect(screen.getByText("Apple Inc")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "pick AAPL" })).not.toBeInTheDocument();
    // Regression this guards: InstrumentPicker renders the identity row
    // whenever `instrument` is non-null regardless of `locked`, so neither of
    // the assertions above would catch `lockedInstrument` being wired wrong.
    // The Change button is the only observable difference — it would let a
    // dialog whose entire premise is "the instrument is already known" swap
    // the instrument out from under itself.
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  });

  it("offers the custom-holding path from inside the dialog", async () => {
    renderWithClient(<TransactionDialog mode="add" />);
    await userEvent.click(screen.getByRole("button", { name: /Add transaction/ }));
    expect(screen.getByRole("link", { name: /custom holding/i })).toHaveAttribute(
      "href",
      "/custom-holding/new",
    );
  });

  it("stays open after save-and-add-another and closes after a plain save", async () => {
    renderWithClient(<TransactionDialog mode="add" instrument={AAPL} />);
    await userEvent.click(screen.getByRole("button", { name: /Add transaction/ }));
    await userEvent.type(screen.getByLabelText("Quantity"), "10");
    await userEvent.type(screen.getByLabelText("Price / share"), "100");

    await userEvent.click(screen.getByRole("button", { name: "Save and add another" }));
    expect(await screen.findByLabelText("Quantity")).toBeInTheDocument();

    // Save-and-add-another clears quantity/price/fee (transaction-form.test.tsx
    // covers that directly), so the next entry needs both refilled — a
    // quantity-only retype would fail validation and never reach onSubmit.
    await userEvent.type(screen.getByLabelText("Quantity"), "5");
    await userEvent.type(screen.getByLabelText("Price / share"), "100");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByLabelText("Quantity")).not.toBeInTheDocument());
  });

  it("keeps the dialog open with the typed values and shows the error on a failed save-and-add-another", async () => {
    // Regression this guards: a catch branch that returns `true` instead of
    // `false` would make TransactionForm treat the failed save as a success
    // and clear quantity/price/fee — discarding what the user typed. Nothing
    // else in this file exercises a rejected createTransaction, so a mutated
    // catch branch previously passed all 25 tests across this file and
    // transaction-form.test.tsx.
    vi.mocked(api.createTransaction).mockRejectedValueOnce(new Error("Could not save."));
    renderWithClient(<TransactionDialog mode="add" instrument={AAPL} />);
    await userEvent.click(screen.getByRole("button", { name: /Add transaction/ }));
    await userEvent.type(screen.getByLabelText("Quantity"), "10");
    await userEvent.type(screen.getByLabelText("Price / share"), "100");

    await userEvent.click(screen.getByRole("button", { name: "Save and add another" }));

    await screen.findByText("Could not save.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toHaveValue("10");
    expect(screen.getByLabelText("Price / share")).toHaveValue("100");
  });

  it("keeps the fixed instrument after closing and reopening", async () => {
    // Regression this guards: resetting to `null` instead of `fixedInstrument
    // ?? null` on close would reopen a locked dialog with an empty picker and
    // no search box to recover with — a dead end. All 9 dialog tests
    // previously passed with that mutation because none of them closed and
    // reopened a fixed-instrument dialog.
    renderWithClient(<TransactionDialog mode="add" instrument={AAPL} />);
    await userEvent.click(screen.getByRole("button", { name: /Add transaction/ }));
    expect(screen.getByText("Apple Inc")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Add transaction/ }));
    expect(screen.getByText("Apple Inc")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "pick AAPL" })).not.toBeInTheDocument();
  });
});

describe("TransactionDialog edit mode", () => {
  it("locks the instrument and prefills all fields including fee", () => {
    renderWithClient(
      <TransactionDialog mode="edit" row={row} open onOpenChange={vi.fn()} />,
      makeTestQueryClient(),
    );
    expect(screen.queryByText("pick AAPL")).not.toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toHaveValue("10");
    expect(screen.getByLabelText("Fee")).toHaveValue("1.50");
  });

  it("updates the transaction with the edited fee", async () => {
    renderWithClient(
      <TransactionDialog mode="edit" row={row} open onOpenChange={vi.fn()} />,
      makeTestQueryClient(),
    );
    fireEvent.change(screen.getByLabelText("Fee"), { target: { value: "3.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.updateTransaction).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({
          type: "buy",
          quantity: "10",
          price: "100",
          fee: "3.25",
          feeCurrency: "USD",
        }),
      ),
    );
  });
});
