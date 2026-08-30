import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders the title as a level-1 heading", () => {
    render(<PageHeader title="Holdings" />);
    expect(screen.getByRole("heading", { level: 1, name: "Holdings" })).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(<PageHeader title="T" description="All positions." />);
    expect(screen.getByText("All positions.")).toBeInTheDocument();
  });

  it("renders nothing extra when description is absent", () => {
    render(<PageHeader title="T" />);
    expect(screen.queryByText("All positions.")).not.toBeInTheDocument();
  });

  it("renders a ReactNode description without wrapping it in a <p>", () => {
    const { container } = render(
      <PageHeader
        title="T"
        description={
          <>
            All figures after tax. <a href="/settings">Change in Settings</a>
          </>
        }
      />,
    );
    expect(screen.getByText(/All figures after tax\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change in Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(container.querySelector("p")).not.toBeInTheDocument();
  });

  it("renders actions", () => {
    render(<PageHeader title="T" actions={<button type="button">Sync</button>} />);
    expect(screen.getByRole("button", { name: "Sync" })).toBeInTheDocument();
  });

  // A rigid action group is right on a desktop and wrong on a phone: on
  // /dividends the segmented control plus two buttons held a fixed 434px inside
  // a 360px column, and the page scrolled sideways. `shrink-0` only from sm up,
  // and the group wraps below it.
  it("lets its actions wrap on a phone instead of forcing a side-scroll", () => {
    render(<PageHeader title="T" actions={<button type="button">Sync</button>} />);
    const group = screen.getByRole("button", { name: "Sync" }).parentElement as HTMLElement;
    expect(group.className).toContain("flex-wrap");
    expect(group.className).toContain("sm:shrink-0");
    // Unconditional shrink-0 is the bug this replaced.
    expect(group.className).not.toMatch(/(^|\s)shrink-0(\s|$)/);
  });

  // Without min-w-0 a long title refuses to shrink and pushes the actions out
  // of the row rather than truncating.
  it("lets a long title shrink rather than shove the actions off the row", () => {
    render(<PageHeader title="A very long portfolio page title" actions={<button>Sync</button>} />);
    const titleBlock = screen.getByRole("heading", { level: 1 }).parentElement as HTMLElement;
    expect(titleBlock.className).toContain("min-w-0");
  });
});
