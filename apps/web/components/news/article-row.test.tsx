import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArticleRow } from "./article-row";
import { MediaPrefsProvider } from "../media-prefs-context";
import { renderWithClient } from "@/lib/test/render-with-client";
import type { NewsArticleDTO } from "@/lib/types";

// The provider follows the user-settings query; keep it pending so each test
// sees exactly the `initial` it passed.
vi.mock("@/lib/api", () => ({ getUserSettings: () => new Promise(() => {}) }));

const article: NewsArticleDTO = {
  title: "Coca-Cola raises its dividend",
  url: "https://example.invalid/story",
  publisher: "Example Wire",
  publishedAt: "2026-08-30T09:00:00Z",
  thumbnailUrl: "https://images.example.invalid/story.jpg",
  relatedSymbols: ["KO"],
  otherSymbols: [],
};

function renderWithThumbnails(on: boolean, ui = <ArticleRow article={article} />) {
  return renderWithClient(
    <MediaPrefsProvider
      initial={{ showCompanyLogos: false, showNewsThumbnails: on, logoDevToken: null }}
    >
      {ui}
    </MediaPrefsProvider>,
  );
}

/** A thumbnail is a request to the publisher's image host, from the reader's
 *  address, made without them clicking anything — down a feed scoped to their
 *  holdings. Same disclosure company logos are off by default for. */
describe("ArticleRow thumbnails", () => {
  it("asks nobody for an image by default", () => {
    render(<ArticleRow article={article} />);
    expect(document.querySelector("img")).toBeNull();
    // The headline still renders — this is a layout the app already ships,
    // not a degraded one.
    expect(screen.getByText("Coca-Cola raises its dividend")).toBeInTheDocument();
  });

  it("asks nobody while the user's switch is off", () => {
    renderWithThumbnails(false);
    expect(document.querySelector("img")).toBeNull();
  });

  it("loads the image once the user turns thumbnails on", () => {
    renderWithThumbnails(true);
    expect(document.querySelector("img")).toHaveAttribute("src", article.thumbnailUrl);
  });

  it("stays off where the caller already suppressed thumbnails", () => {
    renderWithThumbnails(true, <ArticleRow article={article} showThumbnail={false} />);
    expect(document.querySelector("img")).toBeNull();
  });
});
