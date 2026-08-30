import { screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";

import * as api from "../lib/api";
vi.mock("../lib/api", () => ({
  getUserSettings: vi.fn(),
  updateDisplayCurrency: vi.fn().mockResolvedValue(undefined),
}));

import { CurrencyPicker } from "./currency-picker";

beforeEach(() => vi.clearAllMocks());

function renderPicker(initialCurrency: string | null) {
  const qc = makeTestQueryClient();
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const result = renderWithClient(<CurrencyPicker initialCurrency={initialCurrency} />, qc);
  return { ...result, invalidateSpy };
}

describe("CurrencyPicker", () => {
  it("renders the chip showing the initial currency", () => {
    renderPicker("DKK");
    expect(screen.getByText("DKK")).toBeInTheDocument();
  });

  it("renders 'Native' when initialCurrency is null", () => {
    renderPicker(null);
    expect(screen.getByText("Native")).toBeInTheDocument();
  });

  it("selecting a currency updates optimistically, calls the API, and invalidates the currency-keyed caches", async () => {
    const { invalidateSpy } = renderPicker("DKK");
    fireEvent.click(screen.getByText("DKK"));

    fireEvent.click(await screen.findByText("EUR"));

    expect(screen.getByText("EUR")).toBeInTheDocument();
    await waitFor(() => expect(api.updateDisplayCurrency).toHaveBeenCalledWith("EUR"));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["diversification"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["portfolio-history"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["user-settings"] });
  });

  it("never fetches user settings on mount", () => {
    renderPicker("DKK");
    expect(api.getUserSettings).not.toHaveBeenCalled();
  });

  it("rolls the chip back when the save fails", async () => {
    vi.mocked(api.updateDisplayCurrency).mockRejectedValueOnce(new Error("fail"));
    const { invalidateSpy } = renderPicker("DKK");
    fireEvent.click(screen.getByText("DKK"));

    fireEvent.click(await screen.findByText("EUR"));

    await waitFor(() => expect(screen.getByText("DKK")).toBeInTheDocument());
    expect(screen.queryByText("EUR")).not.toBeInTheDocument();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
