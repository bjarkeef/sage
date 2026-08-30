import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithClient, makeTestQueryClient } from "../../../lib/test/render-with-client";
import { qk } from "../../../lib/query/keys";
import type { NewsArticleDTO } from "../../../lib/types";

vi.mock("../../../lib/api", () => ({ getPortfolioNews: vi.fn() }));

import NewsPage from "./page";

function article(over: Partial<NewsArticleDTO> = {}): NewsArticleDTO {
  return {
    title: "Apple hits a record high",
    publisher: "Bloomberg",
    url: "https://example.com/a",
    publishedAt: new Date().toISOString(),
    thumbnailUrl: null,
    relatedSymbols: ["AAPL"],
    holding: {
      symbol: "AAPL",
      name: "Apple Inc",
      weightPct: 20,
      dayChangePercent: 1.5,
      website: "https://apple.com",
    },
    otherSymbols: [],
    ...over,
  };
}

describe("NewsPage", () => {
  it("renders the deduped feed with related tickers and external links", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.portfolioNews(), [
      article(),
      article({
        title: "Realty Income raises payout",
        url: "https://example.com/b",
        relatedSymbols: ["O"],
        holding: {
          symbol: "O",
          name: "Realty Income Corp",
          weightPct: 5,
          dayChangePercent: null,
          website: "https://realtyincome.com",
        },
      }),
    ]);
    renderWithClient(<NewsPage />, qc);

    expect(screen.getByRole("heading", { name: "News" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Apple hits a record high/ });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    // the holding each headline is attributed to leads the meta line. Ignore
    // the logo chip: with logos off it draws the ticker's initials, which for a
    // one-letter symbol like O is the whole symbol again.
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("O", { ignore: '[aria-hidden="true"]' })).toBeInTheDocument();
  });

  it("shows an empty state (not a bare box) when the feed is empty", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.portfolioNews(), []);
    renderWithClient(<NewsPage />, qc);

    expect(screen.getByText(/No headlines yet/)).toBeInTheDocument();
  });
});
