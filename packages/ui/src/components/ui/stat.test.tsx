import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stat, StatStrip } from "./stat";

describe("Stat", () => {
  it("renders label eyebrow, value, and context line", () => {
    render(<Stat label="Annual income" value="$1,204" context="+6.8% YoY" />);
    expect(screen.getByText("Annual income")).toBeInTheDocument();
    expect(screen.getByText("$1,204")).toBeInTheDocument();
    expect(screen.getByText("+6.8% YoY")).toBeInTheDocument();
  });

  it("size drives the numeral class", () => {
    render(<Stat label="A" value="1" size="hero" />);
    expect(screen.getByText("1").className).toContain("hero-num");
  });

  it("defaults to the stat numeral", () => {
    render(<Stat label="A" value="2" />);
    expect(screen.getByText("2").className).toContain("stat-num");
  });
});

describe("StatStrip", () => {
  it("renders children in a hairline-divided strip", () => {
    render(
      <StatStrip data-testid="strip">
        <Stat label="A" value="1" />
        <Stat label="B" value="2" />
      </StatStrip>,
    );
    const strip = screen.getByTestId("strip");
    expect(strip.className).toContain("divide-hairline-faint");
    expect(strip.className).not.toContain("shadow");
  });
});
