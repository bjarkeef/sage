import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithClient, makeTestQueryClient } from "../../../../lib/test/render-with-client";
import { qk } from "../../../../lib/query/keys";
import type { NewsArticleDTO } from "../../../../lib/types";

// Fetcher is mocked so the import resolves; tests seed the cache (fresh, within
// staleTime) so the queryFn never fires and render states are deterministic.
vi.mock("../../../../lib/api", () => ({ getAssetNews: vi.fn() }));

import { NewsSection } from "./news-section";

function article(over: Partial<NewsArticleDTO> = {}): NewsArticleDTO {
  return {
    title: "Apple hits a record high",
    publisher: "Reuters",
    url: "https://example.com/a",
    publishedAt: new Date().toISOString(),
    thumbnailUrl: null,
    relatedSymbols: ["AAPL"],
    ...over,
  };
}

describe("NewsSection", () => {
  it("renders headlines with the publisher and an external link", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.assetNews("XNAS-AAPL"), [article()]);
    renderWithClient(<NewsSection slug="XNAS-AAPL" />, qc);

    expect(screen.getByText("Apple hits a record high")).toBeInTheDocument();
    expect(screen.getByText(/Reuters/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Apple hits a record high/ });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("is absent entirely when the feed is empty", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.assetNews("XNAS-AAPL"), []);
    renderWithClient(<NewsSection slug="XNAS-AAPL" />, qc);

    expect(screen.queryByRole("heading", { name: "News" })).not.toBeInTheDocument();
  });
});
