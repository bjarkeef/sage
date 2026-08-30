import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient, makeTestQueryClient } from "../../../lib/test/render-with-client";
import type { CategoriesViewDTO, CategoryNodeDTO } from "../../../lib/types";

vi.mock("../../../lib/api", () => ({
  saveCategories: vi.fn(),
  getCategoriesView: vi.fn(),
  getUserSettings: vi.fn(),
}));

import { CategoriesEditor } from "./categories-editor";
import * as api from "../../../lib/api";

const money = (amount: string) => ({ amount, currency: "DKK" });
const ZERO = money("0.00");

const holding = (symbol: string, name: string, targetPct: number | null = null) => ({
  symbol,
  name,
  website: null,
  value: money("200.00"),
  invested: money("150.00"),
  gain: money("50.00"),
  gainPercent: 33.33,
  weightPct: 50,
  targetPct,
});

const cat = (id: string, name: string, over: Partial<CategoryNodeDTO> = {}): CategoryNodeDTO => ({
  id,
  name,
  targetPct: null,
  actualPct: 0,
  value: ZERO,
  invested: ZERO,
  gain: ZERO,
  gainPercent: null,
  children: [],
  holdings: [],
  itemCount: 0,
  ...over,
});

const FIXTURE: CategoriesViewDTO = {
  root: cat("root", "Portfolio", {
    value: money("400.00"),
    invested: money("350.00"),
    gain: money("50.00"),
    gainPercent: 14.29,
    actualPct: 100,
    children: [
      cat("cat-1", "Growth", {
        targetPct: 40,
        actualPct: 50,
        value: money("200.00"),
        invested: money("150.00"),
        gain: money("50.00"),
        gainPercent: 33.33,
        holdings: [holding("AAPL", "Apple Inc")],
        itemCount: 1,
      }),
    ],
    itemCount: 1,
  }),
  unallocated: [holding("MSFT", "Microsoft")],
  totals: {
    value: money("400.00"),
    invested: money("350.00"),
    gain: money("50.00"),
    gainPercent: 14.29,
    targetPctSum: 40,
  },
  fxIncomplete: false,
};

function withCategories(...children: CategoryNodeDTO[]): CategoriesViewDTO {
  return { ...FIXTURE, root: { ...FIXTURE.root, children } };
}

beforeEach(() => vi.clearAllMocks());

function renderEditor(onClose = vi.fn(), data: CategoriesViewDTO = FIXTURE) {
  const qc = makeTestQueryClient();
  renderWithClient(<CategoriesEditor data={data} displayCurrency="DKK" onClose={onClose} />, qc);
  return { qc, onClose };
}

/** The card wrapping a category's name input (cards are role=button shells). */
function cardOf(name: string): HTMLElement {
  const card = screen.getByDisplayValue(name).closest('[role="button"]');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe("CategoriesEditor — selection follows deletes", () => {
  const THREE = withCategories(
    FIXTURE.root.children[0]!,
    cat("cat-2", "Income"),
    cat("cat-3", "Bonds"),
  );

  it("keeps the selection on the same category when another is deleted", () => {
    renderEditor(vi.fn(), THREE);
    fireEvent.click(cardOf("Income"));
    fireEvent.click(screen.getByRole("button", { name: "Delete Growth" }));
    fireEvent.click(screen.getByRole("button", { name: /assign MSFT/i }));
    expect(within(cardOf("Income")).getByText("MSFT")).toBeInTheDocument();
    expect(within(cardOf("Bonds")).queryByText("MSFT")).not.toBeInTheDocument();
  });

  it("clears the selection when the selected category itself is deleted", () => {
    renderEditor(vi.fn(), THREE);
    fireEvent.click(cardOf("Bonds"));
    fireEvent.click(screen.getByRole("button", { name: "Delete Bonds" }));
    // Nothing is selected, so assigning would have to guess a destination.
    expect(screen.getByRole("button", { name: /assign MSFT/i })).toBeDisabled();
    expect(screen.getByText(/Select a category first/)).toBeInTheDocument();
  });

  it("includes a negative target in the headline sum instead of hiding it", () => {
    renderEditor();
    // Growth's target is 40; make it -10 and the sum must follow, not freeze.
    fireEvent.change(screen.getByDisplayValue("40"), { target: { value: "-10" } });
    expect(screen.getByText("-10.0% targeted")).toBeInTheDocument();
  });
});

describe("CategoriesEditor — nesting", () => {
  const TWO = withCategories(FIXTURE.root.children[0]!, cat("cat-2", "Income"));

  it("moves a category inside another and saves it as a child", async () => {
    const saveSpy = vi.spyOn(api, "saveCategories").mockResolvedValue(FIXTURE);
    renderEditor(vi.fn(), TWO);

    fireEvent.change(screen.getByLabelText("Parent of Income"), { target: { value: "cat-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const payload = saveSpy.mock.calls[0]![0];
    expect(payload.categories).toHaveLength(1);
    expect(payload.categories[0]!.name).toBe("Growth");
    expect(payload.categories[0]!.children?.map((c) => c.name)).toEqual(["Income"]);
  });

  it("will not offer a category its own descendant as a parent", () => {
    renderEditor(vi.fn(), TWO);
    fireEvent.change(screen.getByLabelText("Parent of Income"), { target: { value: "cat-1" } });

    // Growth now sits above Income, so choosing Income as Growth's parent
    // would close a loop — the option is simply not there.
    const parentOfGrowth = screen.getByLabelText("Parent of Growth");
    const options = within(parentOfGrowth)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Portfolio"]);
  });

  it("promotes children rather than deleting the subtree with the parent", () => {
    renderEditor(vi.fn(), TWO);
    fireEvent.change(screen.getByLabelText("Parent of Income"), { target: { value: "cat-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete Growth" }));

    // Income survives, back at the root — one click must not take a subtree.
    expect(screen.getByDisplayValue("Income")).toBeInTheDocument();
    expect(screen.getByLabelText("Parent of Income")).toHaveValue("");
  });

  it("counts only root-level targets toward the headline sum", () => {
    renderEditor(vi.fn(), TWO);
    fireEvent.change(screen.getByLabelText("Target for Income"), { target: { value: "25" } });
    expect(screen.getByText("65.0% targeted")).toBeInTheDocument();

    // Nested, Income's 25% is a share of Growth — not of the portfolio.
    fireEvent.change(screen.getByLabelText("Parent of Income"), { target: { value: "cat-1" } });
    expect(screen.getByText("40.0% targeted")).toBeInTheDocument();
  });
});

describe("CategoriesEditor", () => {
  it("assigns a tray holding to the selected category", () => {
    renderEditor();
    // Growth is the only (and thus selected) category; click the MSFT tray chip
    fireEvent.click(screen.getByRole("button", { name: /assign MSFT/i }));
    // MSFT now listed inside the Growth card, tray no longer offers assignment
    expect(screen.queryByRole("button", { name: /assign MSFT/i })).not.toBeInTheDocument();
    expect(screen.getByText("Microsoft")).toBeInTheDocument();
  });

  it("removes a holding back to the tray", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /remove AAPL/i }));
    expect(screen.getByRole("button", { name: /assign AAPL/i })).toBeInTheDocument();
  });

  it("saves the edited structure with the payload the API expects", async () => {
    const saveSpy = vi.spyOn(api, "saveCategories").mockResolvedValue(FIXTURE);
    const { onClose } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /assign MSFT/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy).toHaveBeenCalledWith(
      {
        categories: [
          {
            id: "cat-1",
            name: "Growth",
            targetPct: 40,
            holdings: [
              { symbol: "AAPL", targetPct: null },
              { symbol: "MSFT", targetPct: null },
            ],
            children: [],
          },
        ],
        rootHoldings: [],
      },
      "DKK",
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("carries a per-asset target through to the payload", async () => {
    const saveSpy = vi.spyOn(api, "saveCategories").mockResolvedValue(FIXTURE);
    renderEditor();

    fireEvent.change(screen.getByLabelText("Target for AAPL in Growth"), {
      target: { value: "70" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy.mock.calls[0]![0].categories[0]!.holdings).toEqual([
      { symbol: "AAPL", targetPct: 70 },
    ]);
  });

  it("adds and deletes a category, returning its holdings to the tray", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    // Two name inputs now (Growth + the new empty one)
    expect(screen.getAllByPlaceholderText("Category name")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /delete growth/i }));
    expect(screen.getByRole("button", { name: /assign AAPL/i })).toBeInTheDocument();
  });

  it("cancel closes without saving", () => {
    const saveSpy = vi.spyOn(api, "saveCategories");
    const { onClose } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(saveSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces a save error inline and stays open", async () => {
    vi.spyOn(api, "saveCategories").mockRejectedValue(new Error("duplicate category name"));
    const { onClose } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText(/duplicate category name/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not swallow a space typed into a category name (card's keyboard-select guard must ignore bubbled input keydowns)", async () => {
    renderEditor();
    const nameInput = screen.getByPlaceholderText("Category name");
    await userEvent.type(nameInput, " Stocks");
    expect(nameInput).toHaveValue("Growth Stocks");
  });
});
