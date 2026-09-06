import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../../../lib/test/render-with-client";
import { qk } from "../../../lib/query/keys";
import type { CorporateActionsViewDTO } from "../../../lib/types";
import CorporateActionsPage from "./page";

vi.mock("../../../lib/api", () => ({ getCorporateActions: vi.fn() }));

const VIEW: CorporateActionsViewDTO = {
  actions: [
    {
      symbol: "ACME",
      name: "Acme Ultra Income ETF",
      date: "2025-11-30",
      ratio: "10 → 1",
      kind: "reverse-split",
      verdict: "adjusted",
      detectedFactor: 10.06,
      mismatchedSamples: 2,
      checkedSamples: 2,
      pricesFrom: "2024-02-29",
    },
    {
      symbol: "THAMES.L",
      name: null,
      date: "2025-09-16",
      ratio: "1 → 1.7992",
      kind: "split",
      verdict: "unadjusted",
      detectedFactor: null,
      mismatchedSamples: null,
      checkedSamples: null,
      pricesFrom: "2023-03-02",
    },
  ],
  coverage: { checked: 216, total: 289 },
};

beforeEach(() => vi.clearAllMocks());

describe("CorporateActionsPage", () => {
  it("renders each action with its ratio", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), VIEW);
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText("ACME")).toBeInTheDocument());
    expect(screen.getByText("10 → 1")).toBeInTheDocument();
    expect(screen.getByText("1 → 1.7992")).toBeInTheDocument();
  });

  // Two actions, two different verdicts, each explaining itself without
  // reference to the other — the reason this page exists.
  it("explains each verdict on its own terms", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), VIEW);
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText("Corrected")).toBeInTheDocument());
    expect(screen.getByText(/10\.06×/)).toBeInTheDocument();
    expect(screen.getByText("Not corrected")).toBeInTheDocument();
    expect(screen.getByText(/genuinely unadjusted/)).toBeInTheDocument();
  });

  // Without its denominator a verdict list invites false confidence.
  it("states how much of the book could be checked", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), VIEW);
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText(/216 of 289/)).toBeInTheDocument());
  });

  // On a cold store this is every row, so it must say why and what to do.
  it("names the price boundary when an action could not be checked", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), {
      actions: [{ ...VIEW.actions[0]!, verdict: "unverified", pricesFrom: "2025-09-05" }],
      coverage: { checked: 0, total: 289 },
    });
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText("Not checked")).toBeInTheDocument());
    expect(screen.getByText(/Backfilling price history/)).toBeInTheDocument();
  });

  it("shows an empty state for a book with no corporate actions", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), { actions: [], coverage: { checked: 0, total: 0 } });
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText(/No corporate actions/i)).toBeInTheDocument());
    expect(screen.queryByText("Corrected")).not.toBeInTheDocument();
  });
});
