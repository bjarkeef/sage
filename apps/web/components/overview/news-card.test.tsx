import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithClient, makeTestQueryClient } from "../../lib/test/render-with-client";
import { qk } from "../../lib/query/keys";
import type { NewsArticleDTO } from "../../lib/types";

// Fetcher mocked so the import resolves; tests seed a fresh cache entry so the
// queryFn never fires and render states are deterministic.
vi.mock("../../lib/api", () => ({ getPortfolioNews: vi.fn() }));

import { NewsCard } from "./news-card";

function article(over: Partial<NewsArticleDTO> = {}): NewsArticleDTO {
  return {
    title: "Markets rally into the close",
    publisher: "Reuters",
    url: "https://example.com/a",
    publishedAt: new Date().toISOString(),
    thumbnailUrl: null,
    relatedSymbols: ["AAPL"],
    holding: {
      symbol: "AAPL",
      name: "Apple Inc",
      weightPct: 18.4,
      dayChangePercent: -2.4,
      website: null,
    },
    otherSymbols: [],
    ...over,
  };
}

describe("NewsCard", () => {
  it("renders headlines and an 'All news' link to the feed", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.portfolioNews(), [article()]);
    renderWithClient(<NewsCard />, qc);

    expect(screen.getByText("Markets rally into the close")).toBeInTheDocument();
    const all = screen.getByRole("link", { name: /All news/ });
    expect(all).toHaveAttribute("href", "/news");
  });

  it("is absent entirely when the portfolio feed is empty", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.portfolioNews(), []);
    renderWithClient(<NewsCard />, qc);

    expect(screen.queryByText("News")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /All news/ })).not.toBeInTheDocument();
  });

  it("attributes each headline to the holding it is about", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.portfolioNews(), [article()]);
    renderWithClient(<NewsCard />, qc);

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("-2.40%")).toBeInTheDocument();
  });

  it("counts the other holdings an article spans", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.portfolioNews(), [article({ otherSymbols: ["MSFT", "O"] })]);
    renderWithClient(<NewsCard />, qc);

    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
