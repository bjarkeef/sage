import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportSection } from "./export-section";
import { downloadTransactionsCsv, downloadExportJson } from "../lib/api";

vi.mock("../lib/api", () => ({
  downloadTransactionsCsv: vi.fn(() => Promise.resolve()),
  downloadExportJson: vi.fn(() => Promise.resolve()),
}));

describe("ExportSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("explains what each file contains", () => {
    render(<ExportSection />);
    // Substrings unique to the explanatory prose (not shared with either
    // button's accessible name) so this test can't pass on the buttons alone.
    expect(screen.getByText(/yours to take/i)).toBeInTheDocument();
    expect(screen.getByText(/custom holdings/i)).toBeInTheDocument();
  });

  it("downloads the CSV", async () => {
    render(<ExportSection />);
    await userEvent.click(screen.getByRole("button", { name: /transactions/i }));
    expect(downloadTransactionsCsv).toHaveBeenCalledTimes(1);
  });

  it("downloads the JSON export", async () => {
    render(<ExportSection />);
    await userEvent.click(screen.getByRole("button", { name: /all data/i }));
    expect(downloadExportJson).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failure instead of failing silently", async () => {
    vi.mocked(downloadTransactionsCsv).mockRejectedValueOnce(new Error("boom"));
    render(<ExportSection />);
    await userEvent.click(screen.getByRole("button", { name: /transactions/i }));
    expect(await screen.findByText(/could not/i)).toBeInTheDocument();
  });
});
