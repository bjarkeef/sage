import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithClient } from "@/lib/test/render-with-client";
import AppLayout from "./layout";

// The shell's own chrome draws company logos too — the command palette lives in
// the sidebar. Stand each piece in with a logo so the test can see which side
// of the MediaPrefsProvider it landed on.
vi.mock("../../components/sidebar", async () => {
  const { CompanyLogo } = await import("../../components/company-logo");
  return { Sidebar: () => <CompanyLogo website="https://www.apple.com" symbol="AAPL" /> };
});
vi.mock("../../components/mobile-nav", async () => {
  const { CompanyLogo } = await import("../../components/company-logo");
  return { MobileNav: () => <CompanyLogo website="https://www.microsoft.com" symbol="MSFT" /> };
});
vi.mock("../../components/providers-degraded-callout", () => ({
  ProvidersDegradedCallout: () => null,
}));
vi.mock("../../lib/api", () => ({
  getUserSettings: vi.fn().mockResolvedValue({
    name: "Test User",
    displayCurrency: null,
    showCompanyLogos: true,
    showNewsThumbnails: false,
    logoDevToken: "pk_mine",
  }),
}));

describe("AppLayout media prefs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("gives the sidebar and the mobile nav the user's logo setting, not the default", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "");

    renderWithClient(await AppLayout({ children: <p>page</p> }));

    for (const name of ["AAPL logo", "MSFT logo"]) {
      const src = screen.getByRole("img", { name }).getAttribute("src") ?? "";
      expect(src).toMatch(/^https:\/\/img\.logo\.dev\//);
      expect(src).toContain("token=pk_mine");
    }
  });
});
