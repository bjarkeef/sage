import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArticleRow, newsThumbnailsEnabled } from "./article-row";
import type { NewsArticleDTO } from "@/lib/types";

const article: NewsArticleDTO = {
  title: "Coca-Cola raises its dividend",
  url: "https://example.invalid/story",
  publisher: "Example Wire",
  publishedAt: "2026-08-30T09:00:00Z",
  thumbnailUrl: "https://images.example.invalid/story.jpg",
  relatedSymbols: ["KO"],
  otherSymbols: [],
};

const ORIGINAL = process.env.NEXT_PUBLIC_NEWS_THUMBNAILS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_NEWS_THUMBNAILS;
  else process.env.NEXT_PUBLIC_NEWS_THUMBNAILS = ORIGINAL;
});

/** A thumbnail is a request to the publisher's image host, from the reader's
 *  address, made without them clicking anything — down a feed scoped to their
 *  holdings. Same disclosure company logos are turned off for. */
describe("ArticleRow thumbnails", () => {
  it("asks nobody for an image by default", () => {
    delete process.env.NEXT_PUBLIC_NEWS_THUMBNAILS;
    render(<ArticleRow article={article} />);
    expect(document.querySelector("img")).toBeNull();
    // The headline still renders — this is a layout the app already ships,
    // not a degraded one.
    expect(screen.getByText("Coca-Cola raises its dividend")).toBeInTheDocument();
  });

  it("loads the image once the operator opts in", () => {
    process.env.NEXT_PUBLIC_NEWS_THUMBNAILS = "true";
    render(<ArticleRow article={article} />);
    expect(document.querySelector("img")).toHaveAttribute("src", article.thumbnailUrl);
  });

  it("treats any value other than true as off", () => {
    // A half-set variable must not leak; only an explicit opt-in counts.
    process.env.NEXT_PUBLIC_NEWS_THUMBNAILS = "1";
    expect(newsThumbnailsEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_NEWS_THUMBNAILS = "";
    expect(newsThumbnailsEnabled()).toBe(false);
  });

  it("stays off where the caller already suppressed thumbnails", () => {
    process.env.NEXT_PUBLIC_NEWS_THUMBNAILS = "true";
    render(<ArticleRow article={article} showThumbnail={false} />);
    expect(document.querySelector("img")).toBeNull();
  });
});
