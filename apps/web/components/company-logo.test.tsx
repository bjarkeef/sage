import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompanyLogo, logoSources } from "./company-logo";

// This suite exists because the component leaked. Until 2026-08-29 it asked
// Google's favicon endpoint for each held company's domain with no token and no
// setting to stop it, which told a third party what the instance's owner holds.
// The guard that matters is the default one: with nothing configured, rendering
// a logo must produce no request to anywhere.
describe("logoSources", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("asks nobody when no logo token is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "");

    expect(logoSources("apple.com", "AAPL")).toEqual([]);
  });

  it("still asks nobody when the instrument has no website", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "");

    expect(logoSources(null, "AAPL")).toEqual([]);
  });

  it("uses only logo.dev once a token opts in", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "pk_test");

    const sources = logoSources("apple.com", "AAPL");

    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.startsWith("https://img.logo.dev/"))).toBe(true);
  });

  it("falls back to the ticker endpoint for an instrument with no website", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "pk_test");

    expect(logoSources(null, "THAMES.L")).toEqual([
      "https://img.logo.dev/ticker/THAMES.L?token=pk_test&size=128&format=png&retina=true",
    ]);
  });
});

describe("CompanyLogo", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renders initials, and no image, when nothing is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "");

    render(<CompanyLogo website="https://www.apple.com" symbol="AAPL" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("AA")).toBeInTheDocument();
  });

  it("renders an image once a token opts in", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "pk_test");

    render(<CompanyLogo website="https://www.apple.com" symbol="AAPL" />);

    expect(screen.getByRole("img", { name: "AAPL logo" })).toBeInTheDocument();
  });
});
