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
