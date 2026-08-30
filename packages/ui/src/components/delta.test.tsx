import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Delta, toneForValue } from "./delta";

describe("toneForValue", () => {
  it("classifies sign", () => {
    expect(toneForValue(5)).toBe("gain");
    expect(toneForValue(-5)).toBe("loss");
    expect(toneForValue(0)).toBe("neutral");
  });
});

describe("Delta", () => {
  it("renders signed absolute + signed percent, no glyphs", () => {
    render(<Delta value={115.17} percent={1.56} currency="USD" data-testid="d" />);
    const el = screen.getByTestId("d");
    expect(el).toHaveTextContent("+$115.17");
    expect(el).toHaveTextContent("(+1.56%)");
    expect(el.textContent).not.toMatch(/[▲▼•]/);
    expect(el).toHaveAttribute("data-tone", "gain");
  });

  it("renders losses with a minus sign and loss tone", () => {
    render(<Delta value={-58.68} percent={-4.66} currency="USD" data-testid="d" />);
    const el = screen.getByTestId("d");
    expect(el.textContent).toContain("$58.68");
    expect(el.textContent).toContain("4.66%");
    expect(el.textContent).toMatch(/[-−]/);
    expect(el).toHaveAttribute("data-tone", "loss");
  });

  it("zero renders unsigned neutral", () => {
    render(<Delta value={0} data-testid="d" />);
    const el = screen.getByTestId("d");
    expect(el).toHaveTextContent("0.00");
    expect(el.textContent).not.toContain("+");
    expect(el).toHaveAttribute("data-tone", "neutral");
  });

  it("chip variant keeps the pill classes", () => {
    render(<Delta value={1} variant="chip" data-testid="d" />);
    expect(screen.getByTestId("d").className).toContain("rounded-full");
  });

  it("renders sr-only accessibility label per tone", () => {
    const { container: gainContainer } = render(<Delta value={1} data-testid="gain" />);
    expect(gainContainer.querySelector(".sr-only")?.textContent).toBe("gain");

    const { container: lossContainer } = render(<Delta value={-1} data-testid="loss" />);
    expect(lossContainer.querySelector(".sr-only")?.textContent).toBe("loss");

    const { container: zeroContainer } = render(<Delta value={0} data-testid="zero" />);
    expect(zeroContainer.querySelector(".sr-only")?.textContent).toBe("flat");
  });

  it("applies tone CSS class to root span", () => {
    render(<Delta value={1} data-testid="gain" />);
    expect(screen.getByTestId("gain").className).toContain("text-gain");

    render(<Delta value={-1} data-testid="loss" />);
    expect(screen.getByTestId("loss").className).toContain("text-loss");
  });

  it("chip variant applies tone tint background", () => {
    render(<Delta value={1} variant="chip" data-testid="gain-chip" />);
    expect(screen.getByTestId("gain-chip").className).toContain("bg-gain/12");

    render(<Delta value={-1} variant="chip" data-testid="loss-chip" />);
    expect(screen.getByTestId("loss-chip").className).toContain("bg-loss/12");
  });

  it("default text variant does not contain rounded-full", () => {
    render(<Delta value={1} data-testid="text" />);
    expect(screen.getByTestId("text").className).not.toContain("rounded-full");
  });
});
