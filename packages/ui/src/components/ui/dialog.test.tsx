import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./dialog";

function open(children: React.ReactNode, size?: "default" | "lg") {
  return render(
    <Dialog open>
      <DialogContent size={size}>
        <DialogTitle>Add transaction</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>,
  );
}

describe("DialogContent", () => {
  it("is 512px wide by default", () => {
    open(null);
    expect(screen.getByRole("dialog").className).toContain("max-w-lg");
  });

  it("widens to 576px for form dialogs", () => {
    open(null, "lg");
    const cls = screen.getByRole("dialog").className;
    expect(cls).toContain("max-w-xl");
    // Both classes present would leave the width to CSS source order.
    expect(cls).not.toContain("max-w-lg");
  });
});

describe("DialogContent on a short viewport", () => {
  // A dialog centred at top-1/2 with no height bound loses both ends of a tall
  // form off-viewport, and nothing scrolls them back. Bounding the height is
  // the fix; it is not mobile-specific, a laptop in a video call is short too.
  it("bounds its own height so tall content scrolls instead of clipping", () => {
    open(null);
    const cls = screen.getByRole("dialog").className;
    expect(cls).toMatch(/max-h-\[/);
    expect(cls).toContain("overflow-y-auto");
  });

  // dvh, not vh: mobile browser chrome is excluded from dvh, so a footer
  // measured in vh sits underneath the address bar.
  it("measures that bound in dvh so browser chrome cannot clip the footer", () => {
    open(null);
    expect(screen.getByRole("dialog").className).toContain("dvh");
  });

  // Below sm the dialog anchors to the bottom rather than centring, which keeps
  // its actions above the on-screen keyboard.
  it("anchors to the bottom as a sheet below sm", () => {
    open(null);
    const cls = screen.getByRole("dialog").className;
    expect(cls).toContain("max-sm:bottom-0");
    expect(cls).toContain("max-sm:top-auto");
    expect(cls).toContain("max-sm:translate-y-0");
  });
});

describe("DialogFooter", () => {
  // Cancel + "Save and add another" + Save is 10px wider than a 375px phone,
  // which put the primary action off the right edge behind a horizontal
  // scroll. Wrapping is the fix, and it belongs to the primitive so every
  // dialog inherits it rather than each one rediscovering the problem.
  it("wraps its actions rather than pushing the primary one off a narrow screen", () => {
    open(
      <DialogFooter>
        <button>Cancel</button>
        <button>Save</button>
      </DialogFooter>,
    );
    const footer = screen.getByRole("button", { name: "Save" }).parentElement as HTMLElement;
    expect(footer.className).toContain("flex-wrap");
  });

  it("renders its actions above a hairline rule", () => {
    open(
      <DialogFooter>
        <button>Cancel</button>
        <button>Save</button>
      </DialogFooter>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    const footer = screen.getByRole("button", { name: "Save" }).parentElement as HTMLElement;
    expect(footer.className).toContain("border-t");
  });
});
