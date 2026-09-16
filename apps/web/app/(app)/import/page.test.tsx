import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient, makeTestQueryClient } from "@/lib/test/render-with-client";
import ImportPage from "./page";
import type { ImportPreviewDTO, ImportResultDTO } from "@/lib/types";

// vi.mock factories are hoisted above module consts — mocks must be hoisted too
// or the factory throws "cannot access before initialization".
const { previewMock, commitMock, inspectMock, previewCsvMock, commitCsvMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  commitMock: vi.fn(),
  inspectMock: vi.fn(),
  previewCsvMock: vi.fn(),
  commitCsvMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  previewSnowballImport: previewMock,
  commitSnowballImport: commitMock,
  inspectCsvImport: inspectMock,
  previewCsvImport: previewCsvMock,
  commitCsvImport: commitCsvMock,
}));

function makePreview(overrides: Partial<ImportPreviewDTO> = {}): ImportPreviewDTO {
  return {
    transactions: [
      {
        symbol: "AAPL",
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "USD",
        tradeDate: "2026-01-01",
        fee: null,
        feeCurrency: null,
        exchange: "NASDAQ",
      },
    ],
    deleted: [
      {
        symbol: "MSFT",
        type: "buy",
        quantity: "5",
        price: "200",
        currency: "USD",
        tradeDate: "2026-02-01",
        fee: null,
        feeCurrency: null,
        exchange: "NASDAQ",
      },
    ],
    skipped: [],
    instruments: [],
    warnings: [],
    summary: {
      buys: 1,
      sells: 0,
      dividends: 0,
      splits: 0,
      skipped: 0,
      deleted: 1,
      newInstruments: 0,
    },
    ...overrides,
  };
}

const result: ImportResultDTO = {
  inserted: 1,
  restored: 1,
  claimedExisting: 0,
  skippedDuplicates: 0,
  instrumentsCreated: 0,
};

/** Restore-of-deleted-rows is a Snowball-format feature, so these pick that
 *  format explicitly. They used to rely on it being the default; it is not any
 *  more — "Any broker CSV" is, since that is the format most people arrive
 *  with — and a test that silently depended on the default would have gone
 *  green again the moment someone changed it back. */
async function uploadFile(qc = makeTestQueryClient()) {
  const user = userEvent.setup();
  renderWithClient(<ImportPage />, qc);
  await user.click(screen.getByRole("radio", { name: "Snowball" }));
  const input = document.getElementById("csv-upload") as HTMLInputElement;
  await user.upload(input, new File(["csv"], "portfolio.csv", { type: "text/csv" }));
  await waitFor(() => expect(previewMock).toHaveBeenCalled());
  return user;
}

describe("ImportPage restore toggle", () => {
  beforeEach(() => {
    previewMock.mockReset().mockResolvedValue(makePreview());
    commitMock.mockReset().mockResolvedValue(result);
  });

  it("shows the previously-deleted section and excludes it from the count by default", async () => {
    await uploadFile();
    expect(screen.getByText("Previously deleted (1)")).toBeDefined();
    expect(screen.getByRole("button", { name: "Import 1 transactions" })).toBeDefined();
  });

  it("checking restore raises the count and passes the flag to commit", async () => {
    const user = await uploadFile();
    await user.click(screen.getByText("Previously deleted (1)"));
    await user.click(screen.getByRole("checkbox"));
    const button = screen.getByRole("button", { name: "Import 2 transactions" });
    await user.click(button);
    await waitFor(() => expect(commitMock).toHaveBeenCalledWith(expect.any(File), true));
    expect(await screen.findByText("1 deleted transactions restored")).toBeDefined();
  });

  it("commits with restoreDeleted=false when unchecked", async () => {
    const user = await uploadFile();
    await user.click(screen.getByRole("button", { name: "Import 1 transactions" }));
    await waitFor(() => expect(commitMock).toHaveBeenCalledWith(expect.any(File), false));
  });

  it("invalidates the portfolio-wide cache after a successful commit", async () => {
    const qc = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const user = await uploadFile(qc);
    await user.click(screen.getByRole("button", { name: "Import 1 transactions" }));
    await waitFor(() => expect(commitMock).toHaveBeenCalled());
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["transactions"] }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  /** The import chose a display currency for a user who had none. Say which,
   *  and where to change it — a currency switching under someone unannounced
   *  reads as a bug. Then refresh what reads the setting, Goal included. */
  it("names the display currency the import chose, and refreshes what reads it", async () => {
    commitMock.mockReset().mockResolvedValue({ ...result, displayCurrencySet: "EUR" });
    const qc = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const user = await uploadFile(qc);
    await user.click(screen.getByRole("button", { name: "Import 1 transactions" }));

    expect(await screen.findByText(/Figures now show in EUR/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["user-settings"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["goal"] });
  });

  it("says nothing about currency when the import did not choose one", async () => {
    const user = await uploadFile();
    await user.click(screen.getByRole("button", { name: "Import 1 transactions" }));
    expect(await screen.findByText("Import complete")).toBeDefined();
    expect(screen.queryByText(/Figures now show in/)).toBeNull();
  });
});

/** Snowball was the default because it was built first, so someone arriving
 *  from any other broker met an importer named after a competitor and a drop
 *  zone asking for a "Snowball Analytics export". The generic path is both the
 *  common case and the stronger one — its column detection reads an ordinary
 *  broker export unaided. */
describe("ImportPage default format", () => {
  it("opens on the any-broker path, not the competitor's export format", () => {
    renderWithClient(<ImportPage />, makeTestQueryClient());

    expect(screen.getByRole("radio", { name: "Any broker CSV" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Snowball" })).toHaveAttribute("data-active", "false");
  });

  it("tells an arriving user the columns get mapped, rather than demanding a format they do not have", () => {
    renderWithClient(<ImportPage />, makeTestQueryClient());

    // Scoped to the drop zone. The page description still mentions Snowball,
    // which is true and useful; what must not happen is the upload target
    // itself asking for a competitor's export before anyone has chosen it.
    const dropzone = document.querySelector('label[for="csv-upload"]') as HTMLElement;
    expect(dropzone).toHaveTextContent(/you will map columns next/i);
    expect(dropzone).not.toHaveTextContent(/Snowball Analytics export/);
  });
});

/** The mapping step maps columns. It could not map the *values* inside the type
 *  column, so an export saying "Reinvest Shares" had no in-app fix at all — the
 *  rows were skipped and the user had to edit the CSV by hand. */
describe("ImportPage type-value mapping", () => {
  const inspectPayload = {
    headers: ["Date", "Symbol", "Action", "Quantity", "Price", "Currency"],
    sampleRows: [],
    rowCount: 3,
    suggestedMapping: {
      tradeDate: "Date",
      symbol: "Symbol",
      type: "Action",
      quantity: "Quantity",
      price: "Price",
      currency: "Currency",
    },
    valuesByColumn: {
      Action: [
        { value: "Buy", normalized: "buy", count: 2, resolved: "buy" as const },
        { value: "Reinvest Shares", normalized: "reinvest shares", count: 1, resolved: null },
      ],
    },
  };

  async function openMappingStep(payload: unknown = inspectPayload) {
    inspectMock.mockReset().mockResolvedValue(payload);
    previewCsvMock.mockReset().mockResolvedValue(makePreview());
    const user = userEvent.setup();
    renderWithClient(<ImportPage />, makeTestQueryClient());
    const input = document.getElementById("csv-upload") as HTMLInputElement;
    await user.upload(input, new File(["csv"], "broker.csv", { type: "text/csv" }));
    await waitFor(() => expect(inspectMock).toHaveBeenCalled());
    return user;
  }

  it("flags the values it could not place, and counts the rows at stake", async () => {
    await openMappingStep();
    expect(await screen.findByText(/1 row uses a word Sage does not recognise/)).toBeDefined();
    expect(screen.getByLabelText("Type for Reinvest Shares")).toHaveValue("");
  });

  it("shows what it read a recognised value as, without calling it an override", async () => {
    await openMappingStep();
    const select = screen.getByLabelText<HTMLSelectElement>("Type for Buy");
    expect(select.value).toBe("");
    expect(select.options[0]!.textContent).toBe("Auto — buy");
  });

  it("sends a chosen value mapping through to the preview", async () => {
    const user = await openMappingStep();
    await user.selectOptions(screen.getByLabelText("Type for Reinvest Shares"), "buy");
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await waitFor(() => expect(previewCsvMock).toHaveBeenCalled());
    expect(previewCsvMock.mock.calls[0]![1]).toMatchObject({
      typeAliases: { "reinvest shares": "buy" },
    });
  });
});

/** defaultCurrency existed for the single-currency broker that omits the
 *  column, but both the button's enable rule and the server validator still
 *  demanded a real currency column — so the field could never be reached. */
describe("ImportPage currency fallback", () => {
  const noCurrency = {
    headers: ["Date", "Symbol", "Type", "Quantity", "Price"],
    sampleRows: [],
    rowCount: 1,
    suggestedMapping: {
      tradeDate: "Date",
      symbol: "Symbol",
      type: "Type",
      quantity: "Quantity",
      price: "Price",
      currency: null,
    },
    valuesByColumn: {},
  };

  it("lets a default currency stand in for a missing column", async () => {
    inspectMock.mockReset().mockResolvedValue(noCurrency);
    previewCsvMock.mockReset().mockResolvedValue(makePreview());
    const user = userEvent.setup();
    renderWithClient(<ImportPage />, makeTestQueryClient());
    const input = document.getElementById("csv-upload") as HTMLInputElement;
    await user.upload(input, new File(["csv"], "broker.csv", { type: "text/csv" }));
    await waitFor(() => expect(inspectMock).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Preview import" })).toBeDisabled();

    await user.type(screen.getByLabelText(/Default currency/), "gbp");
    expect(screen.getByRole("button", { name: "Preview import" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await waitFor(() => expect(previewCsvMock).toHaveBeenCalled());
    expect(previewCsvMock.mock.calls[0]![1]).toMatchObject({
      currency: null,
      defaultCurrency: "GBP",
    });
  });
});
