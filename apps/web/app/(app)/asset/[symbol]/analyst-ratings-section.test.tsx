import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithClient, makeTestQueryClient } from "../../../../lib/test/render-with-client";
import { qk } from "../../../../lib/query/keys";
import type { AnalystRatingsDTO } from "../../../../lib/types";

vi.mock("../../../../lib/api", () => ({ getAssetRatings: vi.fn() }));

import { AnalystRatingsSection } from "./analyst-ratings-section";

const usd = (amount: string) => ({ amount, currency: "USD" });

function ratings(over: Partial<AnalystRatingsDTO> = {}): AnalystRatingsDTO {
  return {
    consensusKey: "buy",
    distribution: { strongBuy: 6, buy: 23, hold: 14, sell: 2, strongSell: 2 },
    targets: { low: usd("215"), mean: usd("318.25"), high: usd("400"), median: null },
    currentPrice: usd("320.67"),
    analystCount: 43,
    asOf: new Date().toISOString(),
    upgradeHistory: [
      {
        firm: "HSBC",
        fromGrade: "Hold",
        toGrade: "Buy",
        action: "up",
        date: "2026-07-17T00:00:00.000Z",
      },
    ],
    ...over,
  };
}

describe("AnalystRatingsSection", () => {
  it("renders consensus, analyst count, targets, and upgrade history", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.assetRatings("XNAS-AAPL"), ratings());
    renderWithClient(<AnalystRatingsSection slug="XNAS-AAPL" />, qc);

    expect(screen.getByRole("heading", { name: "Analyst ratings" })).toBeInTheDocument();
    expect(screen.getByText("43 analysts")).toBeInTheDocument();
    expect(screen.getByText("$318.25")).toBeInTheDocument(); // average target
    expect(screen.getByText("HSBC")).toBeInTheDocument();
    expect(screen.getByText("Hold → Buy")).toBeInTheDocument();
  });

  it("is absent entirely when the provider has no coverage (null)", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.assetRatings("XNAS-AAPL"), null);
    renderWithClient(<AnalystRatingsSection slug="XNAS-AAPL" />, qc);

    expect(screen.queryByRole("heading", { name: "Analyst ratings" })).not.toBeInTheDocument();
  });
});
