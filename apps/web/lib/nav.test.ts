import { describe, expect, it } from "vitest";
import { activeNavHref, mobileTabs, navGroups, navItems } from "./nav";

describe("mobileTabs", () => {
  // The bottom bar is a subset of the sidebar, not a second nav with its own
  // routes. A tab pointing somewhere navItems does not is a route that exists
  // on a phone and nowhere else.
  it("only names routes the sidebar already offers", () => {
    const hrefs = new Set(navItems.map((i) => i.href));
    for (const tab of mobileTabs) {
      expect(hrefs, `${tab.href} is not in navItems`).toContain(tab.href);
    }
  });

  // Four routes plus a More entry. Five is the ceiling before targets get too
  // narrow to hit with a thumb at 375px.
  it("stays within four tabs, leaving room for More", () => {
    expect(mobileTabs.length).toBeLessThanOrEqual(4);
  });

  it("carries the icon from the sidebar's own entry", () => {
    const byHref = new Map(navItems.map((i) => [i.href, i]));
    for (const tab of mobileTabs) {
      expect(tab.icon).toBe(byHref.get(tab.href)?.icon);
    }
  });

  // The sidebar calls this one "Calendar" because a "Dividends" group header
  // sits above it. The bar has no group headers, so inheriting that label
  // leaves the word "Dividends" nowhere in phone navigation, next to a coin
  // icon that could mean anything.
  it("says Dividends on the bottom bar, not the sidebar's Calendar", () => {
    const tab = mobileTabs.find((t) => t.href === "/dividends");
    expect(tab?.label).toBe("Dividends");
    expect(navItems.find((i) => i.href === "/dividends")?.label).toBe("Calendar");
  });
});

describe("navGroups", () => {
  // The analytics page was reachable only from a button inside another page:
  // absent from the sidebar, from the command palette (which reads navItems),
  // and from the mobile More sheet. All three read these exports, so being
  // here is what makes it addressable in all three.
  it("offers dividend analytics as a real destination", () => {
    expect(navItems.map((i) => i.href)).toContain("/dividends/analytics");
  });

  it("groups the two dividend destinations together", () => {
    const group = navGroups.find((g) => g.label === "Dividends");
    expect(group, "no Dividends group").toBeDefined();
    expect(group!.items.map((i) => i.href)).toEqual(["/dividends", "/dividends/analytics"]);
  });

  // The bottom bar has four cells and the calendar is the daily one. If the
  // group ever reorders, the tab must still resolve to the calendar and not to
  // analytics.
  it("keeps the calendar as the mobile dividends tab", () => {
    expect(mobileTabs.map((t) => t.href)).toContain("/dividends");
    expect(mobileTabs.map((t) => t.href)).not.toContain("/dividends/analytics");
  });

  // The page exists but nothing pointed at it until this entry — reachable
  // only from a diagnostic banner on /performance before this, which a reader
  // would only ever see if something already looked wrong.
  it("offers corporate actions as a real destination, beside performance", () => {
    expect(navItems.map((i) => i.href)).toContain("/corporate-actions");
    const group = navGroups.find((g) => g.label === null);
    const hrefs = group!.items.map((i) => i.href);
    expect(hrefs.indexOf("/corporate-actions")).toBe(hrefs.indexOf("/performance") + 1);
  });

  // The bottom bar is already at its four-tab ceiling (see above); a low-
  // traffic diagnostic page does not bump one of those off.
  it("keeps corporate actions off the bottom bar", () => {
    expect(mobileTabs.map((t) => t.href)).not.toContain("/corporate-actions");
  });
});

describe("activeNavHref", () => {
  // The bug this exists to prevent: `/dividends` is a prefix of
  // `/dividends/analytics`, so a plain startsWith lights BOTH entries. Under
  // the old rule this assertion sees two.
  it("marks exactly one entry current on a nested route, the deepest one", () => {
    const current = activeNavHref("/dividends/analytics");
    const matches = navItems.filter((i) => i.href === current);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.href).toBe("/dividends/analytics");
    expect(matches[0]!.label).toBe("Analytics");
  });

  it("keeps the parent current on the parent's own route", () => {
    expect(activeNavHref("/dividends")).toBe("/dividends");
  });

  // A route below a nav entry belongs to that entry — /holdings owns the
  // holding you drilled into.
  it("gives a child route to its nearest entry", () => {
    expect(activeNavHref("/holdings/AAPL")).toBe("/holdings");
  });

  // Segment boundaries, not raw prefixes: a future /newsletter must not light
  // News.
  it("does not match a longer word that merely starts the same", () => {
    expect(activeNavHref("/newsletter")).toBeNull();
  });

  // "/" prefixes every path, so it is active only on itself.
  it("keeps Overview to its own route", () => {
    expect(activeNavHref("/")).toBe("/");
    expect(activeNavHref("/settings")).toBe("/settings");
  });

  it("returns null for a route no nav entry owns", () => {
    expect(activeNavHref("/asset/AAPL")).toBeNull();
  });
});
