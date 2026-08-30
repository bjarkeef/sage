import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { renderWithClient } from "../lib/test/render-with-client";

// holdings-list -> holding-row now renders TransactionDialog, which imports
// ../lib/api; without this mock getInstrumentQuote is undefined and the
// dialog's quote effect throws calling .then on it.
vi.mock("../lib/api", () => ({
  createTransaction: vi.fn().mockResolvedValue({ id: "new" }),
  updateTransaction: vi.fn().mockResolvedValue(undefined),
  getInstrumentQuote: vi.fn().mockResolvedValue(null),
}));

import { HoldingsList } from "./holdings-list";
import type { PositionDTO, SubtotalDTO } from "../lib/types";

function position(overrides: Partial<PositionDTO> = {}): PositionDTO {
  return {
    symbol: "AAPL",
    name: "Apple Inc",
    exchange: "XNAS",
    currency: "USD",
    nativeCurrency: "USD",
    quantity: "10",
    averageCost: { amount: "100", currency: "USD" },
    costBasis: { amount: "1000", currency: "USD" },
    currentPrice: { amount: "150", currency: "USD" },
    marketValue: { amount: "1500", currency: "USD" },
    unrealizedGainLoss: { amount: "500", currency: "USD" },
    gainLossPercent: 50,
    dailyChange: { amount: "20", currency: "USD" },
    dailyChangePercent: 1.35,
    dividendIncome: { amount: "20", currency: "USD" },
    totalReturn: { amount: "520", currency: "USD" },
    totalReturnPercent: 52,
    website: "https://apple.com",
    yieldOnCost: 0.032,
    basisMismatch: null,
    ...overrides,
  };
}

const subtotals: SubtotalDTO[] = [
  {
    currency: "USD",
    costBasis: { amount: "3000", currency: "USD" },
    marketValue: { amount: "4000", currency: "USD" },
    gainLoss: { amount: "1000", currency: "USD" },
  },
];

describe("HoldingsList", () => {
  it("renders a holding's unrealized gain, yield, and weight under column headers", () => {
    renderWithClient(<HoldingsList positions={[position()]} subtotals={subtotals} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("Apple Inc")).toBeInTheDocument();
    // Headline is the unrealized price gain (500 over 1000 cost basis), gain tone
    // — NOT total return (520), which would fold in dividends.
    const ret = screen.getAllByText("+$500.00")[0]!.closest("[data-tone]");
    expect(ret?.getAttribute("data-tone")).toBe("gain");
    // Readable-row columns: yield on cost sits under weight; lifetime dividends
    // moved to the asset page (max-4-columns rule).
    expect(screen.getByText("3.20% yld")).toBeInTheDocument();
    expect(screen.queryByText(/divs/)).not.toBeInTheDocument();
    // Weight: 1500 / 4000 subtotal = 37.5%.
    expect(screen.getByText(/37\.5%/)).toBeInTheDocument();
    // Faint-caps column headers over the data columns ("Value"/"Return" also
    // exist as sort chips, hence getAllByText).
    for (const h of ["Holding", "Value", "Return", "Weight"]) {
      const caps = screen.getAllByText(h).filter((el) => el.className.includes("label-caps"));
      expect(caps).toHaveLength(1);
    }
  });

  it("orders holdings by market value, largest first", () => {
    const big = position({
      symbol: "BIG",
      name: "Big Co",
      marketValue: { amount: "3000", currency: "USD" },
    });
    const small = position({
      symbol: "SML",
      name: "Small Co",
      marketValue: { amount: "100", currency: "USD" },
    });
    renderWithClient(<HoldingsList positions={[small, big]} subtotals={subtotals} />);
    const tickers = screen.getAllByTestId("holding-symbol").map((n) => n.textContent);
    expect(tickers).toEqual(["BIG", "SML"]);
  });

  it("shows an unavailable state when a position has no price", () => {
    renderWithClient(
      <HoldingsList
        positions={[
          position({ marketValue: null, unrealizedGainLoss: null, gainLossPercent: null }),
        ]}
        subtotals={subtotals}
      />,
    );
    expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
  });

  it("renders a per-currency summary header", () => {
    renderWithClient(<HoldingsList positions={[position()]} subtotals={subtotals} />);
    const header = screen.getByTestId("currency-summary-USD");
    expect(within(header).getByText(/USD/)).toBeInTheDocument();
    expect(within(header).getByText("$4,000.00")).toBeInTheDocument();
  });

  it("offers a quick add on each holding row", async () => {
    renderWithClient(<HoldingsList positions={[position()]} subtotals={subtotals} />);
    expect(
      await screen.findByRole("button", { name: /Add transaction for AAPL/ }),
    ).toBeInTheDocument();
  });

  it("quick-adds in the ledger's currency, not the display currency", async () => {
    // The bug this guards: PositionDTO.currency is the *display* currency. A
    // USD-ledger holding shown in DKK reported "DKK", the quick-add posted a
    // DKK transaction against a USD ledger, and the API refused it as a
    // currency_mismatch -- which surfaced as a bare "Could not save the
    // transaction." Every earlier fixture had the two currencies equal, so
    // nothing caught it.
    renderWithClient(
      <HoldingsList
        positions={[position({ currency: "DKK", nativeCurrency: "USD" })]}
        subtotals={subtotals}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Add transaction for AAPL/ }));

    // USD appears in the identity row and as the price/fee suffixes; what
    // matters is that the display currency appears nowhere in the dialog.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("USD").length).toBeGreaterThan(0);
    expect(within(dialog).queryByText("DKK")).not.toBeInTheDocument();
  });

  it("marks a holding whose price basis disagrees with its transactions", () => {
    renderWithClient(
      <HoldingsList
        positions={[
          position({
            symbol: "SPLITCO",
            basisMismatch: {
              symbol: "SPLITCO",
              factor: 10.06,
              mismatched: 4,
              samples: 5,
              firstDate: "2025-10-27",
              lastDate: "2025-11-07",
            },
          }),
        ]}
        subtotals={subtotals}
      />,
    );
    expect(screen.getByLabelText(/price basis/i)).toBeInTheDocument();
  });

  it("leaves a clean holding unmarked", () => {
    renderWithClient(<HoldingsList positions={[position()]} subtotals={subtotals} />);
    expect(screen.queryByLabelText(/price basis/i)).not.toBeInTheDocument();
  });

  it("lets the sort control scroll horizontally instead of overflowing a narrow viewport", () => {
    // Five options ("Value"/"Return"/"Today"/"Yield"/"Name") measure close to
    // the 375px content column's full width, inside rounding error of
    // overflowing it. jsdom can't measure layout, so this checks the
    // structural contract instead: the radiogroup sits inside a wrapper that
    // can scroll rather than clip or force the page to overflow.
    renderWithClient(<HoldingsList positions={[position()]} subtotals={subtotals} />);
    const scroller = screen.getByTestId("holdings-sort-scroll");
    expect(scroller.className).toMatch(/overflow-x-auto/);
    expect(within(scroller).getByRole("radiogroup", { name: /sort/i })).toBeInTheDocument();
  });
});
