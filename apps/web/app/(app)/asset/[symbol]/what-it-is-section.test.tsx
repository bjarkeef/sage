import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WhatItIsSection } from "./what-it-is-section";
import { TODAY, assetDetail, fundDetail } from "../../../../lib/test/asset-fixtures";

describe("WhatItIsSection", () => {
  it("describes a stock: sector, industry, CEO, employees, website", () => {
    render(
      <WhatItIsSection profile={assetDetail().profile} profileAsOf={TODAY} todayISO={TODAY} />,
    );
    expect(screen.getByRole("heading", { name: "What it is" })).toBeInTheDocument();
    expect(screen.getByText("Consumer Defensive")).toBeInTheDocument();
    expect(screen.getByText("Beverages")).toBeInTheDocument();
    expect(screen.getByText("A. Person")).toBeInTheDocument();
    expect(screen.getByText("79,000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "example.com" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(screen.getByText("Sector").parentElement).toHaveAttribute(
      "title",
      expect.stringContaining("as of"),
    );
  });

  it("describes a fund, hiding rows the provider left empty or dashed", () => {
    render(<WhatItIsSection profile={fundDetail().profile} profileAsOf={TODAY} todayISO={TODAY} />);
    expect(screen.getByText("Example Funds")).toBeInTheDocument();
    expect(screen.getByText("$7.79B")).toBeInTheDocument();
    expect(screen.getByText("Global Large-Cap Blend Equity")).toBeInTheDocument();
    // The fixture's legalType is "–": hidden, never printed.
    expect(screen.queryByText("Legal type")).not.toBeInTheDocument();
    expect(screen.queryByText("Sector")).not.toBeInTheDocument();
    expect(screen.queryByText("–")).not.toBeInTheDocument();
  });

  it("sorts a fund's sector weights, largest first", () => {
    render(<WhatItIsSection profile={fundDetail().profile} profileAsOf={TODAY} todayISO={TODAY} />);
    const names = screen
      .getAllByText(/^(Technology|Healthcare|Energy)$/)
      .map((el) => el.textContent);
    expect(names).toEqual(["Technology", "Healthcare", "Energy"]);
  });

  it("clamps a long description to three lines behind 'more'", () => {
    const long = "Makes and sells drinks in many countries. ".repeat(12);
    render(
      <WhatItIsSection
        profile={{ ...assetDetail().profile, description: long }}
        profileAsOf={TODAY}
        todayISO={TODAY}
      />,
    );
    const text = screen.getByText(long.trim());
    expect(text.className).toContain("line-clamp-3");
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    expect(text.className).not.toContain("line-clamp-3");
    expect(screen.getByRole("button", { name: "less" })).toBeInTheDocument();
  });

  it("is absent when the provider gave nothing", () => {
    const p = assetDetail().profile;
    const { container } = render(
      <WhatItIsSection
        profile={{
          ...p,
          sector: null,
          industry: null,
          ceo: null,
          fullTimeEmployees: null,
          website: null,
          description: null,
        }}
        profileAsOf={null}
        todayISO={TODAY}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
