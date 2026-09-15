import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AllocationBars } from "./allocation-bars";

const manyRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `Cat ${i}`, percent: 10 - i }));

describe("AllocationBars", () => {
  it("sorts rows descending by percent", () => {
    render(
      <AllocationBars
        title="Sector"
        rows={[
          { label: "Small", percent: 5 },
          { label: "Big", percent: 60 },
        ]}
      />,
    );
    const labels = screen.getAllByText(/^(Small|Big)$/).map((el) => el.textContent);
    expect(labels).toEqual(["Big", "Small"]);
  });

  it("collapses overflow into Other with summed percent", () => {
    // percents 10..1; maxRows 4 keeps 10, 9, 8 and folds 7+6+5+4+3+2+1 = 28 into Other
    render(<AllocationBars title="Sector" rows={manyRows(10)} maxRows={4} />);
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByText("28.0%")).toBeInTheDocument();
    expect(screen.queryByText("Cat 3")).not.toBeInTheDocument();
  });

  it("clamps bar width to 100%", () => {
    const { container } = render(
      <AllocationBars title="T" rows={[{ label: "Over", percent: 140 }]} />,
    );
    const fill = container.querySelector('div[style*="width"]') as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  it("shows the formatted value when provided", () => {
    render(<AllocationBars title="T" rows={[{ label: "A", percent: 50, value: "€1,000" }]} />);
    expect(screen.getByText("€1,000")).toBeInTheDocument();
  });

  it("bar variant renders one segment per row plus legend dots", () => {
    const rows = [
      { label: "Health care", percent: 31.2 },
      { label: "Technology", percent: 27.4 },
      { label: "Real estate", percent: 15.9 },
    ];
    render(<AllocationBars title="By Sector" rows={rows} variant="bar" />);
    const bar = screen.getByRole("img");
    expect(bar.getAttribute("aria-label")).toContain("Health care 31.2%");
    expect(bar.children).toHaveLength(3);
    expect(screen.getByText("31.2%")).toBeInTheDocument();
  });

  it("bar variant still collapses overflow into Other", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ label: `S${i}`, percent: 10 }));
    render(<AllocationBars title="T" rows={rows} variant="bar" maxRows={5} />);
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("hideTitle suppresses the heading but keeps it in the aria-label", () => {
    const rows = [{ label: "Tech", percent: 60 }];
    render(<AllocationBars title="By Sector" rows={rows} variant="bar" hideTitle />);
    expect(screen.queryByRole("heading", { name: "By Sector" })).not.toBeInTheDocument();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("By Sector");
  });

  // jsdom computes no layout, so the defect this guards — labels compressed to
  // ~25px and ellipsised — is invisible to any width assertion. The track floor
  // is the thing that actually decides it, so assert the floor.
  it("widens the legend track when rows carry a value", () => {
    // `auto-fit` stretches columns to fill, so too low a floor does not
    // overflow: it packs in more columns and silently squeezes every label.
    // A money column needs ~90px of the row, which 190px does not leave.
    const { container } = render(
      <AllocationBars
        title="By sector"
        rows={[{ label: "Consumer Defensive", percent: 50, value: "DKK 50,193.88" }]}
        variant="bar"
      />,
    );
    // An attribute selector cannot carry the unescaped parens in the arbitrary
    // class, so match on the className string instead.
    const legend = [...container.querySelectorAll("div")].find((d) =>
      d.className.includes("auto-fit"),
    )!;

    expect(legend.className).toContain("minmax(300px,1fr)");
  });

  it("keeps the narrow track when rows are label and percent only", () => {
    const { container } = render(
      <AllocationBars title="By sector" rows={[{ label: "Cash", percent: 50 }]} variant="bar" />,
    );
    // An attribute selector cannot carry the unescaped parens in the arbitrary
    // class, so match on the className string instead.
    const legend = [...container.querySelectorAll("div")].find((d) =>
      d.className.includes("auto-fit"),
    )!;

    expect(legend.className).toContain("minmax(190px,1fr)");
  });

  it("hideTitle suppresses the heading in rows variant too", () => {
    const rows = [{ label: "Tech", percent: 60 }];
    render(<AllocationBars title="By Sector" rows={rows} variant="rows" hideTitle />);
    expect(screen.queryByRole("heading", { name: "By Sector" })).not.toBeInTheDocument();
  });
});

describe("AllocationBars segment colors", () => {
  const rows = [
    { label: "Tech", percent: 60 },
    { label: "Health", percent: 40 },
  ];

  it("cycles the seg ramp", () => {
    render(<AllocationBars title="By Sector" rows={rows} variant="bar" />);
    const img = screen.getByRole("img");
    expect(img.firstElementChild).toHaveStyle({ background: "var(--seg-1)" });
    expect(img.children[1]).toHaveStyle({ background: "var(--seg-2)" });
  });
});
