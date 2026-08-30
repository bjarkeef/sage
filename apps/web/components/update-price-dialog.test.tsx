import { screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";

import * as api from "../lib/api";
vi.mock("../lib/api", () => ({
  putPriceMark: vi.fn().mockResolvedValue(undefined),
}));

import { UpdatePriceDialog } from "./update-price-dialog";

beforeEach(() => vi.clearAllMocks());

describe("UpdatePriceDialog", () => {
  it("submits the date and price to putPriceMark and closes on success", async () => {
    const qc = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderWithClient(<UpdatePriceDialog symbol="CASH_DKK" currency="DKK" />, qc);

    fireEvent.click(screen.getByRole("button", { name: "Update price" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-07-18" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "1.02" } });
    fireEvent.click(screen.getByRole("button", { name: "Set price (DKK)" }));

    await waitFor(() =>
      expect(api.putPriceMark).toHaveBeenCalledWith("CASH_DKK", {
        date: "2026-07-18",
        price: "1.02",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Set price (DKK)" })).not.toBeInTheDocument(),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["custom-holding", "CASH_DKK"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["asset-detail", "CASH_DKK"] }),
    );
  });

  it("shows an error and stays open when the request fails", async () => {
    vi.mocked(api.putPriceMark).mockRejectedValueOnce(new Error("price mark failed: 400"));
    renderWithClient(<UpdatePriceDialog symbol="CASH_DKK" currency="DKK" />, makeTestQueryClient());

    fireEvent.click(screen.getByRole("button", { name: "Update price" }));
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "1.05" } });
    fireEvent.click(screen.getByRole("button", { name: "Set price (DKK)" }));

    expect(await screen.findByText("price mark failed: 400")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set price (DKK)" })).toBeInTheDocument();
  });
});
