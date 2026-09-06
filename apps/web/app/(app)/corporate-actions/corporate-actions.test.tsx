import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../../../lib/test/render-with-client";
import { qk } from "../../../lib/query/keys";
import type { CorporateActionsViewDTO } from "../../../lib/types";
import { formatDate } from "../../../lib/format";
import { getCorporateActions } from "../../../lib/api";
import CorporateActionsPage from "./page";

vi.mock("../../../lib/api", () => ({ getCorporateActions: vi.fn() }));

const VIEW: CorporateActionsViewDTO = {
  actions: [
    {
      symbol: "ACME",
      name: "Acme Ultra Income ETF",
      date: "2025-11-30",
      ratio: "10 → 1",
      verdict: "adjusted",
      detectedFactor: 9.94,
      mismatchedSamples: 2,
      checkedSamples: 2,
      pricesFrom: "2024-02-29",
      fxGap: false,
    },
    {
      symbol: "THAMES.L",
      name: null,
      date: "2025-09-16",
      ratio: "1 → 1.3429",
      verdict: "unadjusted",
      detectedFactor: null,
      mismatchedSamples: null,
      checkedSamples: null,
      pricesFrom: "2023-03-02",
      fxGap: false,
    },
  ],
  coverage: { checked: 187, total: 254 },
};

beforeEach(() => vi.clearAllMocks());

describe("CorporateActionsPage", () => {
  it("renders each action with its ratio", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), VIEW);
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText("ACME")).toBeInTheDocument());
    expect(screen.getByText("10 → 1")).toBeInTheDocument();
    expect(screen.getByText("1 → 1.3429")).toBeInTheDocument();
  });

  // Two actions, two different verdicts, each explaining itself without
  // reference to the other — the reason this page exists.
  //
  // `detectedFactor` is the OBSERVED PRICE DIVERGENCE (provider vs ledger),
  // never the multiplier Sage applied to historical quantities — that is the
  // recorded split ratio, "10 → 1" above. Asserting the divergence appears
  // labeled as a disagreement, and that the applied-ratio sentence names the
  // ratio rather than the divergence number, is what pins HIGH-1: the old
  // copy claimed Sage "scales historical quantities by 9.94×", off by
  // roughly 100x from the 0.1x it actually applies.
  it("explains the adjusted verdict as an observed price gap, not the applied multiplier", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), VIEW);
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText("Corrected")).toBeInTheDocument());
    expect(screen.getByText(/disagree about 9\.9×/)).toBeInTheDocument();
    expect(screen.getByText(/scaled by that ratio, not by the price gap/)).toBeInTheDocument();
    // The false claim this test would have let through: "Sage scales
    // historical quantities by 9.9×" or "by 9.94×" — the divergence number
    // must never be presented as an applied multiplier.
    expect(screen.queryByText(/scales historical quantities by/)).not.toBeInTheDocument();
  });

  it("explains a genuinely clean unadjusted verdict as prices agreeing", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), VIEW);
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText("Not corrected")).toBeInTheDocument());
    expect(screen.getByText(/genuinely unadjusted/)).toBeInTheDocument();
  });

  // HIGH-2: `unadjusted` is reached two ways — clean (no finding) and a
  // finding that the recorded split's drift tolerance rejected. The second
  // case is NOT "prices agree" (the old copy claimed this unconditionally);
  // `/performance`'s banner keeps exactly this symbol in its mismatch list,
  // so this page saying "agree" would contradict a banner the reader may
  // have just clicked through from.
  it("explains an unadjusted verdict WITH a finding as a mismatch the split does not explain", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), {
      actions: [
        {
          ...VIEW.actions[1]!,
          verdict: "unadjusted",
          detectedFactor: 9.94,
          mismatchedSamples: 3,
          checkedSamples: 4,
        },
      ],
      coverage: { checked: 4, total: 4 },
    });
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText("Not corrected")).toBeInTheDocument());
    expect(screen.getByText(/do NOT agree with your ledger/)).toBeInTheDocument();
    expect(screen.getByText(/does not explain the gap/)).toBeInTheDocument();
    expect(screen.getByText(/3 of 4 checked trades disagreed about 9\.9×/)).toBeInTheDocument();
    // The exact false claim HIGH-2 found: this state must never render the
    // clean-agreement sentence.
    expect(screen.queryByText(/agree with your ledger, so its history/)).not.toBeInTheDocument();
  });

  // Without its denominator a verdict list invites false confidence.
  it("states how much of the book could be checked", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), VIEW);
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText(/187 of 254/)).toBeInTheDocument());
  });

  // On a cold store this is every row, so it must say why and what to do.
  it("names the price boundary when an action could not be checked", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), {
      actions: [{ ...VIEW.actions[0]!, verdict: "unverified", pricesFrom: "2025-09-05" }],
      coverage: { checked: 0, total: 254 },
    });
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText("Not checked")).toBeInTheDocument());
    // The closing sentence ("Backfilling price history...") renders
    // unconditionally regardless of whether the boundary clause is present,
    // correct, or deleted — asserting it alone would pass even if the
    // boundary date were dropped from `verdictCopy` entirely. The boundary
    // itself, in its rendered (not raw ISO) form, is what actually proves
    // this verdict names its own evidence.
    expect(screen.getByText(new RegExp(formatDate("2025-09-05")))).toBeInTheDocument();
    expect(screen.getByText(/Backfilling price history/)).toBeInTheDocument();
  });

  // A missing FX rate is a different evidence gap than missing price history,
  // and promising that backfilling would help would be false — bars already
  // exist for this symbol.
  it("does not promise backfilling would help when the gap is a missing FX rate", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), {
      actions: [{ ...VIEW.actions[0]!, verdict: "unverified", fxGap: true }],
      coverage: { checked: 0, total: 254 },
    });
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText("Not checked")).toBeInTheDocument());
    expect(screen.getByText(/missing exchange rate/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Backfilling price history would let it decide/),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state for a book with no corporate actions", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.corporateActions(), { actions: [], coverage: { checked: 0, total: 0 } });
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() => expect(screen.getByText(/No corporate actions/i)).toBeInTheDocument());
    expect(screen.queryByText("Corrected")).not.toBeInTheDocument();
  });

  it("shows a retryable error state when the fetch fails", async () => {
    vi.mocked(getCorporateActions).mockRejectedValue(new Error("boom"));
    const qc = makeTestQueryClient();
    renderWithClient(<CorporateActionsPage />, qc);

    await waitFor(() =>
      expect(screen.getByText(/Could not load corporate actions/i)).toBeInTheDocument(),
    );

    vi.mocked(getCorporateActions).mockResolvedValue(VIEW);
    screen.getByRole("button", { name: /try again/i }).click();

    await waitFor(() => expect(screen.getByText("ACME")).toBeInTheDocument());
  });
});
