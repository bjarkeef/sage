import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompanyLogo, logoSources } from "./company-logo";
import { MediaPrefsProvider, type MediaSettings } from "./media-prefs-context";
import { renderWithClient } from "@/lib/test/render-with-client";
import { qk } from "@/lib/query/keys";
import type { UserSettingsDTO } from "@/lib/types";

// The provider follows the user-settings query; keep it pending so a test sees
// exactly the server-rendered `initial` it was given, unless it seeds the cache.
vi.mock("@/lib/api", () => ({ getUserSettings: () => new Promise(() => {}) }));

// This suite exists because the component leaked. Until 2026-08-29 it asked
// Google's favicon endpoint for each held company's domain with no token and no
// setting to stop it, which told a third party what the instance's owner holds.
// The guard that matters is the default one: with nothing turned on, rendering
// a logo must produce no request to anywhere.
describe("logoSources", () => {
  it("asks nobody without a token", () => {
    expect(logoSources("apple.com", "AAPL", null)).toEqual([]);
    expect(logoSources("apple.com", "AAPL", "")).toEqual([]);
  });

  it("still asks nobody when the instrument has no website", () => {
    expect(logoSources(null, "AAPL", null)).toEqual([]);
  });

  it("uses only logo.dev once there is a token", () => {
    const sources = logoSources("apple.com", "AAPL", "pk_test");

    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.startsWith("https://img.logo.dev/"))).toBe(true);
  });

  it("falls back to the ticker endpoint for an instrument with no website", () => {
    expect(logoSources(null, "THAMES.L", "pk_test")).toEqual([
      "https://img.logo.dev/ticker/THAMES.L?token=pk_test&size=128&format=png&retina=true",
    ]);
  });
});

const OFF: MediaSettings = {
  showCompanyLogos: false,
  showNewsThumbnails: false,
  logoDevToken: null,
};

function renderLogo(initial: MediaSettings) {
  return renderWithClient(
    <MediaPrefsProvider initial={initial}>
      <CompanyLogo website="https://www.apple.com" symbol="AAPL" />
    </MediaPrefsProvider>,
  );
}

describe("CompanyLogo", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renders initials, and no image, with no provider at all", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "pk_operator");

    render(<CompanyLogo website="https://www.apple.com" symbol="AAPL" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("AA")).toBeInTheDocument();
  });

  it("renders initials while the switch is off, even with a saved key and an operator key", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "pk_operator");

    renderLogo({ ...OFF, logoDevToken: "pk_mine" });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("AA")).toBeInTheDocument();
  });

  it("renders the logo with the user's own key once the switch is on", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "pk_operator");

    renderLogo({ ...OFF, showCompanyLogos: true, logoDevToken: "pk_mine" });

    const img = screen.getByRole("img", { name: "AAPL logo" });
    expect(img.getAttribute("src")).toContain("token=pk_mine");
  });

  it("falls back to the operator's default key when the user saved none", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "pk_operator");

    renderLogo({ ...OFF, showCompanyLogos: true });

    const img = screen.getByRole("img", { name: "AAPL logo" });
    expect(img.getAttribute("src")).toContain("token=pk_operator");
  });

  it("stays on initials when the switch is on but no key exists anywhere", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "");

    renderLogo({ ...OFF, showCompanyLogos: true });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("follows the settings query over the server-rendered values", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "");
    const settings = {
      showCompanyLogos: true,
      showNewsThumbnails: false,
      logoDevToken: "pk_fresh",
    } as UserSettingsDTO;

    const { queryClient, rerender } = renderLogo(OFF);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    queryClient.setQueryData(qk.userSettings(), settings);
    rerender(
      <MediaPrefsProvider initial={OFF}>
        <CompanyLogo website="https://www.apple.com" symbol="AAPL" />
      </MediaPrefsProvider>,
    );

    expect(screen.getByRole("img", { name: "AAPL logo" }).getAttribute("src")).toContain(
      "token=pk_fresh",
    );
  });
});
