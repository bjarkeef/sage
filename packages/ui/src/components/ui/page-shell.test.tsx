import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageShell } from "./page-shell";

describe("PageShell", () => {
  it("renders children inside a centered default-width container", () => {
    render(<PageShell data-testid="shell">content</PageShell>);
    const shell = screen.getByTestId("shell");
    expect(shell).toHaveTextContent("content");
    expect(shell.className).toContain("max-w-page");
    expect(shell.className).toContain("mx-auto");
  });

  it("supports the narrow width", () => {
    render(<PageShell width="narrow" data-testid="shell" />);
    expect(screen.getByTestId("shell").className).toContain("max-w-narrow");
  });

  // 32px each side is 17% of a 375px phone spent on margin, which was most of
  // why the app read as cramped there. Desktop rhythm is unchanged from sm up.
  it("halves its horizontal padding below sm", () => {
    render(<PageShell data-testid="shell" />);
    const cls = screen.getByTestId("shell").className;
    expect(cls).toContain("px-4");
    expect(cls).toContain("sm:px-8");
    // Unconditional px-8 would win at every width and undo the mobile gain.
    expect(cls).not.toMatch(/(^|\s)px-8(\s|$)/);
  });

  it("merges custom classes", () => {
    render(<PageShell className="pb-12" data-testid="shell" />);
    expect(screen.getByTestId("shell").className).toContain("pb-12");
  });

  it("cascades its children in by default", () => {
    const { container } = render(
      <PageShell>
        <div>a</div>
      </PageShell>,
    );
    expect(container.firstChild).toHaveClass("page-enter");
  });

  it("does not animate a skeleton shell", () => {
    const { container } = render(
      <PageShell animate={false}>
        <div>a</div>
      </PageShell>,
    );
    expect(container.firstChild).not.toHaveClass("page-enter");
  });
});
