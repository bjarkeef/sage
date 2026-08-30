import { screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import * as api from "../lib/api";
vi.mock("../lib/api", () => ({ removeHolding: vi.fn().mockResolvedValue(undefined) }));

import { RemoveHoldingButton } from "./remove-holding-button";

beforeEach(() => vi.clearAllMocks());

function renderButton(symbol = "AAPL") {
  const qc = makeTestQueryClient();
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const result = renderWithClient(<RemoveHoldingButton symbol={symbol} />, qc);
  return { ...result, invalidateSpy };
}

describe("RemoveHoldingButton", () => {
  it("renders a labelled trigger, not an icon-only one", () => {
    renderButton();
    expect(screen.getByRole("button", { name: /remove holding/i })).toBeInTheDocument();
  });

  it("warns that removal deletes the whole ledger before confirming", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /remove holding/i }));
    // The confirm must make the destructiveness explicit — it wipes every
    // transaction for the symbol, not just "the position".
    expect(await screen.findByText(/deletes all transactions/i)).toBeInTheDocument();
    expect(screen.getByText(/AAPL/)).toBeInTheDocument();
  });

  it("removes, invalidates the portfolio caches, then navigates to /holdings", async () => {
    const { invalidateSpy } = renderButton();
    fireEvent.click(screen.getByRole("button", { name: /remove holding/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(api.removeHolding).toHaveBeenCalledWith("AAPL"));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["asset-detail"] });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/holdings"));
  });

  it("cancel closes the popover without removing or navigating", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /remove holding/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText(/deletes all transactions/i)).not.toBeInTheDocument(),
    );
    expect(api.removeHolding).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the error state with retry on failure and does not navigate", async () => {
    vi.mocked(api.removeHolding).mockRejectedValueOnce(new Error("fail"));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /remove holding/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Could not remove the holding.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.removeHolding).toHaveBeenCalledTimes(2));
  });
});
