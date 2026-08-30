import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeTestQueryClient } from "../lib/test/render-with-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../lib/api", () => ({
  createCustomHolding: vi.fn().mockResolvedValue({ symbol: "CASH_DKK" }),
  getCustomHolding: vi.fn(),
  updateCustomHolding: vi.fn(),
}));

import { createCustomHolding } from "../lib/api";
import { CustomHoldingForm } from "./custom-holding-form";

/** Minimal provider wrapper for a component test — mirrors renderWithClient's
 *  QueryClientProvider setup but returns a plain element per this test's shape. */
function withTestProviders(ui: React.ReactElement) {
  const qc = makeTestQueryClient();
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe("CustomHoldingForm", () => {
  it("submits a savings holding with income settings", async () => {
    render(withTestProviders(<CustomHoldingForm mode="create" />));
    fireEvent.change(screen.getByLabelText(/ticker/i), { target: { value: "CASH_DKK" } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Cash account" } });
    fireEvent.change(screen.getByLabelText(/currency/i), { target: { value: "DKK" } });
    fireEvent.click(screen.getByLabelText(/steady income/i));
    fireEvent.change(screen.getByLabelText(/yearly/i), { target: { value: "4.25" } });
    fireEvent.change(screen.getByLabelText(/first payment/i), { target: { value: "2026-04-30" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(createCustomHolding).toHaveBeenCalled());
    const input = vi.mocked(createCustomHolding).mock.calls[0]![0];
    expect(input.symbol).toBe("CASH_DKK");
    expect(input.income?.yearlyPct).toBe("4.25");
  });

  it("hides income fields until the toggle is on", () => {
    render(withTestProviders(<CustomHoldingForm mode="create" />));
    expect(screen.queryByLabelText(/yearly/i)).toBeNull();
  });
});
