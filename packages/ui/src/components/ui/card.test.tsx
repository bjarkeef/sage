import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardTitle } from "./card";

describe("Card", () => {
  it("renders the wash-and-hairline shell with default padding", () => {
    render(<Card data-testid="card">body</Card>);
    const card = screen.getByTestId("card");
    expect(card.className).toContain("bg-surface-card");
    expect(card.className).toContain("border-hairline");
    expect(card.className).toContain("rounded-card");
    expect(card.className).toContain("p-6");
    expect(card.className).not.toContain("shadow");
  });

  it("compact variant uses p-5", () => {
    render(<Card compact data-testid="card" />);
    expect(screen.getByTestId("card").className).toContain("p-5");
  });
});

describe("CardTitle", () => {
  it("renders an h3 with optional meta", () => {
    render(<CardTitle meta="12 payments">Dividends</CardTitle>);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Dividends");
    expect(screen.getByText("12 payments")).toBeInTheDocument();
  });
});
