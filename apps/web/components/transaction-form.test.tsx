import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { formatDate } from "../lib/format";

vi.mock("./instrument-search", () => ({
  InstrumentSearch: ({ id, onSelect }: { id?: string; onSelect: (r: unknown) => void }) => (
    <button
      id={id}
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
  ),
}));

import { TransactionForm, type TransactionFormFields } from "./transaction-form";

const editInstrument = {
  symbol: "AAPL",
  name: "Apple Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock" as const,
};

function editInitial(overrides: Partial<TransactionFormFields> = {}): TransactionFormFields {
  return {
    type: "buy",
    quantity: "10",
    price: "100",
    fee: "",
    tradeDate: "2026-01-01",
    ...overrides,
  };
}

function renderEdit(onSubmit = vi.fn().mockResolvedValue(true), initial = editInitial()) {
  render(
    <TransactionForm
      mode="edit"
      instrument={editInstrument}
      initial={initial}
      submitting={false}
      formError={null}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  return onSubmit;
}

describe("TransactionForm", () => {
  it("shows the fee field for buy and hides it for dividend", () => {
    renderEdit();
    expect(screen.getByLabelText("Fee")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Dividend"));
    expect(screen.queryByLabelText("Fee")).not.toBeInTheDocument();
  });

  it("hides the price field for a split and submits price 0", () => {
    const onSubmit = renderEdit(vi.fn().mockResolvedValue(true), editInitial({ quantity: "2" }));
    fireEvent.click(screen.getByText("Split"));
    expect(screen.queryByLabelText("Price / share")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "split", price: "0", quantity: "2" }),
      { addAnother: false },
    );
  });

  it("clears a typed fee when switching to a fee-less type and back", async () => {
    renderEdit();
    const fee = screen.getByLabelText("Fee");
    await userEvent.type(fee, "5");
    fireEvent.click(screen.getByText("Dividend"));
    fireEvent.click(screen.getByText("Buy"));
    expect(screen.getByLabelText("Fee")).toHaveValue("");
  });

  it("blocks submit and shows an inline error for an empty quantity", () => {
    const onSubmit = renderEdit(vi.fn().mockResolvedValue(true), editInitial({ quantity: "" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Quantity must be a number, like 1.12 or 1,12.")).toBeInTheDocument();
  });

  it("says a grouped number is not a number, rather than calling it non-positive", () => {
    const onSubmit = renderEdit(
      vi.fn().mockResolvedValue(true),
      editInitial({ quantity: "1.000,50" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Quantity must be a number, like 1.12 or 1,12.")).toBeInTheDocument();
  });

  it("says zero must be more than zero", () => {
    const onSubmit = renderEdit(vi.fn().mockResolvedValue(true), editInitial({ price: "0" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Price must be more than zero.")).toBeInTheDocument();
  });

  it("submits valid fields including the fee", () => {
    const onSubmit = renderEdit(vi.fn().mockResolvedValue(true), editInitial({ fee: "2.5" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith(
      { type: "buy", quantity: "10", price: "100", fee: "2.5", tradeDate: "2026-01-01" },
      { addAnother: false },
    );
  });

  it("seeds an empty price from prefillPrice but never overwrites a typed price", () => {
    const { rerender } = render(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        prefillPrice={null}
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    rerender(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        prefillPrice="150.00"
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Price / share")).toHaveValue("150.00");
  });

  it("re-seeds the price when prefillPrice changes after switching instruments", () => {
    const { rerender } = render(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        prefillPrice={null}
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    rerender(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        prefillPrice="150.00"
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Price / share")).toHaveValue("150.00");

    rerender(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        prefillPrice="300.00"
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Price / share")).toHaveValue("300.00");
  });

  it("never overwrites a user-typed price with a later prefill", () => {
    const { rerender } = render(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        prefillPrice={null}
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    rerender(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        prefillPrice="150.00"
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Price / share")).toHaveValue("150.00");

    fireEvent.change(screen.getByLabelText("Price / share"), { target: { value: "175" } });

    rerender(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        prefillPrice="300.00"
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Price / share")).toHaveValue("175");
  });

  it("accepts a decimal comma and submits it with a dot", () => {
    const onSubmit = renderEdit(
      vi.fn().mockResolvedValue(true),
      editInitial({ quantity: "1,12", price: "305,93", fee: "1,5" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith(
      { type: "buy", quantity: "1.12", price: "305.93", fee: "1.5", tradeDate: "2026-01-01" },
      { addAnother: false },
    );
  });

  it("totals a decimal-comma entry", async () => {
    renderEdit(vi.fn().mockResolvedValue(true), editInitial({ quantity: "2", price: "1,25" }));
    expect(await screen.findByText("$2.50")).toBeInTheDocument();
  });

  it("shows a total that includes the fee", async () => {
    renderEdit(
      vi.fn().mockResolvedValue(true),
      editInitial({ quantity: "10", price: "305.93", fee: "1.50" }),
    );
    expect(await screen.findByText("$3,060.80")).toBeInTheDocument();
    expect(screen.getByText("10 × 305.93")).toBeInTheDocument();
  });

  it("subtracts the fee on a sell", async () => {
    renderEdit(
      vi.fn().mockResolvedValue(true),
      editInitial({ type: "sell", quantity: "10", price: "305.93", fee: "1.50" }),
    );
    expect(await screen.findByText("$3,057.80")).toBeInTheDocument();
  });

  it("shows no figure until a quantity is entered", () => {
    renderEdit(vi.fn().mockResolvedValue(true), editInitial({ quantity: "", price: "305.93" }));
    expect(screen.getByText("Enter a quantity")).toBeInTheDocument();
  });

  it("binds the Holding label to the search control when nothing is picked yet", () => {
    // The bug this guards: the input's only accessible name used to be the
    // placeholder ("Search ticker or name…"), which is the anti-pattern
    // Field exists to remove.
    render(
      <TransactionForm
        mode="add"
        instrument={null}
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Holding")).toBeInTheDocument();
  });

  it("degrades the Holding label to a plain caption once an instrument is showing", () => {
    // A picked instrument renders an identity row, not a labelable control —
    // a <label for> pointing at it would bind to nothing.
    render(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Holding").tagName).toBe("SPAN");
  });

  it("renders no search input when the instrument is locked", () => {
    render(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        lockedInstrument
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "pick AAPL" })).not.toBeInTheDocument();
    expect(screen.getByText("Apple Inc")).toBeInTheDocument();
  });

  it("keeps instrument, type and date but clears the amounts after save-and-add-another", async () => {
    // Each field asserted separately on purpose: a blanket "the form still has
    // values" check would pass even if nothing had been cleared.
    const onSubmit = vi.fn().mockResolvedValue(true);
    // "Apple Inc" being visible after add-another is not, by itself, proof the
    // instrument survived: that text is driven by the `instrument` prop, which
    // the parent owns, so a form that quietly called onInstrumentClear would
    // still render it until the parent reacted. Spy on the clear callback
    // directly so a future regression here goes red instead of green.
    const onInstrumentClear = vi.fn();
    render(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        lockedInstrument
        onInstrumentClear={onInstrumentClear}
        initial={{
          type: "sell",
          quantity: "10",
          price: "305.93",
          fee: "1.50",
          tradeDate: "2026-01-01",
        }}
        submitting={false}
        formError={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save and add another" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.anything(), { addAnother: true }),
    );

    expect(screen.getByLabelText("Quantity")).toHaveValue("");
    expect(screen.getByLabelText("Price / share")).toHaveValue("");
    expect(screen.getByLabelText("Fee")).toHaveValue("");
    expect(screen.getByLabelText("Trade date")).toHaveValue("2026-01-01");
    expect(screen.getByText("Apple Inc")).toBeInTheDocument();
    expect(onInstrumentClear).not.toHaveBeenCalled();
    // SegmentedControl renders role="radio" + aria-checked, so the selected
    // type is assertable directly. (Do not assert on className here — a
    // `.className` check that only proves the string exists asserts nothing.)
    expect(screen.getByRole("radio", { name: "Sell" })).toBeChecked();
  });

  it("clears a lingering success receipt so it never sits beside a fresh error", async () => {
    // Regression this guards: without the setLastSaved(null) on a failed
    // save, "Saved AAPL · 10 × 150.00" from the prior add-another would
    // still be on screen once the dialog surfaces the new failure as
    // formError -- a save that reads as both succeeded and failed.
    const onSubmit = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { rerender } = render(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        lockedInstrument
        initial={{ type: "buy", quantity: "10", price: "150.00", fee: "", tradeDate: "2026-01-01" }}
        submitting={false}
        formError={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save and add another" }));
    expect(await screen.findByText(/^Saved AAPL/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Price / share"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and add another" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    // The dialog owns formError and would set it once onSubmit resolves
    // false; simulate that here since TransactionForm itself never sets it.
    rerender(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        lockedInstrument
        initial={{ type: "buy", quantity: "10", price: "150.00", fee: "", tradeDate: "2026-01-01" }}
        submitting={false}
        formError="Could not save the transaction."
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Could not save the transaction.")).toBeInTheDocument();
    expect(screen.queryByText(/^Saved AAPL/)).not.toBeInTheDocument();
  });

  it("clears a lingering success receipt when the transaction type changes", async () => {
    // Regression this guards: without the setLastSaved(null) in
    // handleTypeChange, "Saved AAPL · 10 × 150.00" from a buy would still be
    // showing once the user switches to Dividend -- a receipt for a
    // transaction the form no longer describes.
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        lockedInstrument
        initial={{ type: "buy", quantity: "10", price: "150.00", fee: "", tradeDate: "2026-01-01" }}
        submitting={false}
        formError={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save and add another" }));
    expect(await screen.findByText(/^Saved AAPL/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dividend"));
    expect(screen.queryByText(/^Saved AAPL/)).not.toBeInTheDocument();
  });

  it("keeps the amounts when the save failed", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        lockedInstrument
        initial={{ type: "buy", quantity: "10", price: "305.93", fee: "", tradeDate: "2026-01-01" }}
        submitting={false}
        formError={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and add another" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.getByLabelText("Quantity")).toHaveValue("10");
  });

  it("puts a missing-instrument error under the Holding field", async () => {
    // The rule already existed -- validateTransactionForm returns
    // errors.instrument today. What is asserted here is placement: the message
    // belongs to the Holding field, not adrift in the layout.
    render(
      <TransactionForm
        mode="add"
        instrument={null}
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const message = await screen.findByText("Choose an instrument.");
    // The Field wrapper holds label, control and message together.
    expect(message.closest("div")?.textContent).toContain("Holding");
  });

  it("captions a prefilled price with its market date, absolutely", async () => {
    // Never relative age: asOf is the market's clock, so a healthy Friday
    // close would read "2 days ago" on a Sunday. A hardcoded fixture date
    // only catches a formatRelativeTime regression while it's under 7 days
    // old -- past that, formatRelativeTime falls back to the same absolute
    // date and the test goes quiet instead of red. Deriving "two days ago"
    // from `now` keeps the fixture inside that window forever, and asserting
    // the exact string (not a loose regex) means a relative rendering like
    // "2d ago" can never coincidentally match.
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const prefillAsOf = twoDaysAgo.toISOString();
    const expectedCaption = `Market price · ${formatDate(prefillAsOf.slice(0, 10), { year: "always" })}`;

    render(
      <TransactionForm
        mode="add"
        instrument={editInstrument}
        prefillPrice="305.93"
        prefillAsOf={prefillAsOf}
        submitting={false}
        formError={null}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(await screen.findByText(expectedCaption)).toBeInTheDocument();
  });
});
