import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

vi.mock("./sign-out-button", () => ({ SignOutButton: () => <button>Sign out</button> }));

import { mobileTabs, navItems } from "../lib/nav";
import { MobileNav } from "./mobile-nav";

function renderNav(at = "/") {
  pathname = at;
  return render(<MobileNav />);
}

describe("MobileNav", () => {
  it("is the phone's navigation only — the sidebar takes over from md up", () => {
    const { container } = renderNav();
    const bar = container.querySelector("nav") as HTMLElement;
    expect(bar.className).toContain("md:hidden");
    expect(bar.className).toContain("fixed");
  });

  it("shows a tab for each daily route", () => {
    renderNav();
    const bar = screen.getByRole("navigation");
    for (const tab of mobileTabs) {
      expect(within(bar).getByRole("link", { name: tab.label })).toBeInTheDocument();
    }
  });

  // The bar is a shortcut, not the whole map. Every route stays reachable, or a
  // phone user simply cannot get to Import or Settings.
  it("reaches every remaining route through More", async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole("button", { name: /more/i }));

    const sheet = await screen.findByRole("dialog");
    for (const item of navItems) {
      expect(
        within(sheet).getByRole("link", { name: item.label }),
        `${item.label} unreachable on a phone`,
      ).toBeInTheDocument();
    }
  });

  it("carries the account controls the sidebar keeps in its footer", async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole("button", { name: /more/i }));

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("marks the current route so the bar says where you are", () => {
    renderNav("/holdings");
    const bar = screen.getByRole("navigation");
    const current = within(bar).getByRole("link", { name: "Holdings" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  // `/dividends` is a prefix of `/dividends/analytics`. Under a plain
  // startsWith both dividend entries claim the page: two highlighted rows in
  // the sheet, and aria-current on the bar's Calendar tab while the user is
  // looking at Analytics.
  it("marks only the deepest entry on a nested dividends route", async () => {
    const user = userEvent.setup();
    renderNav("/dividends/analytics");

    const bar = screen.getByRole("navigation");
    expect(within(bar).queryByRole("link", { current: "page" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /more/i }));
    const sheet = await screen.findByRole("dialog");
    const current = within(sheet).getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Analytics");
  });

  // "/" is a prefix of every route, so a startsWith test lights every tab at
  // once. Overview is active only on Overview.
  it("does not light Overview while on another route", () => {
    renderNav("/dividends");
    const bar = screen.getByRole("navigation");
    expect(within(bar).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    // The bottom bar keeps saying "Dividends" even though the sidebar entry
    // behind it is called "Calendar" — the bar has no group header to supply
    // the topic.
    expect(within(bar).getByRole("link", { name: "Dividends" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
