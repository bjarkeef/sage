import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CalendarSkeleton,
  CardGridSkeleton,
  HeroSkeleton,
  PageHeaderSkeleton,
  RowsSkeleton,
  StatStripSkeleton,
} from "./skeletons";

describe("skeletons", () => {
  it("HeroSkeleton reserves hero-shaped space", () => {
    render(<HeroSkeleton />);
    expect(screen.getByRole("status", { name: "Loading portfolio" })).toBeInTheDocument();
  });
  it("RowsSkeleton renders the requested row count", () => {
    const { container } = render(<RowsSkeleton rows={3} />);
    expect(container.querySelectorAll("[data-skeleton-row]")).toHaveLength(3);
  });
  it("StatStripSkeleton renders four cells", () => {
    const { container } = render(<StatStripSkeleton />);
    expect(container.querySelectorAll("[data-skeleton-stat]")).toHaveLength(4);
  });
});

describe("PageHeaderSkeleton", () => {
  it("reserves the same block PageHeader occupies", () => {
    const { container } = render(<PageHeaderSkeleton />);
    // PageHeader is `mb-8` with a 28px title and a 14px description line.
    // Every loading.tsx approximated this with its own widths, so the title
    // block jumped on load on every route.
    expect(container.firstElementChild).toHaveClass("mb-8");
  });

  it("reserves the actions row when the page has one", () => {
    const { container } = render(<PageHeaderSkeleton withActions />);
    expect(container.querySelectorAll("[data-skeleton-action]").length).toBeGreaterThan(0);
  });

  it("renders no actions row by default", () => {
    // Distinguishes withActions=true from the default — without this, a
    // component that always rendered the actions row (ignoring the prop)
    // would still pass the test above.
    const { container } = render(<PageHeaderSkeleton />);
    expect(container.querySelectorAll("[data-skeleton-action]")).toHaveLength(0);
  });
});

describe("CardGridSkeleton", () => {
  it("renders the requested card count", () => {
    const { container } = render(<CardGridSkeleton cards={4} />);
    expect(container.querySelectorAll(":scope > div > div").length).toBe(4);
  });

  it("switches track count between two and three columns", () => {
    const { container: two } = render(<CardGridSkeleton columns={2} />);
    const { container: three } = render(<CardGridSkeleton columns={3} />);
    expect(two.firstElementChild).toHaveClass("md:grid-cols-2");
    expect(three.firstElementChild).not.toHaveClass("md:grid-cols-2");
  });
});

describe("CalendarSkeleton", () => {
  it("renders a seven-column header above a six-week (42-cell) grid", () => {
    render(<CalendarSkeleton />);
    const status = screen.getByRole("status", { name: "Loading calendar" });
    const grids = status.querySelectorAll(".grid-cols-7");
    expect(grids).toHaveLength(2);
    // Header row: 7 day-label cells. Body: 42 day cells (6 weeks).
    expect(grids[0]?.children).toHaveLength(7);
    expect(grids[1]?.children).toHaveLength(42);
  });
});
