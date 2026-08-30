import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RowGrid, RowHeader, DataRow, RowCell } from "./data-row";

describe("RowGrid family", () => {
  it("renders header cells and rows on shared tracks", () => {
    render(
      <RowGrid columns="minmax(0,1fr) 110px" data-testid="grid">
        <RowHeader cells={["Name", "Value"]} align={["left", "right"]} />
        <DataRow data-testid="row">
          <RowCell variant="text" primary="AAPL" secondary="Apple Inc." />
          <RowCell primary="$4,976.85" secondary="15 shares" align="right" />
        </DataRow>
      </RowGrid>,
    );
    expect(screen.getByTestId("grid")).toHaveAttribute("role", "table");
    expect(screen.getByText("Name").className).toContain("label-caps");
    expect(screen.getByText("Value").className).toContain("text-right");
    const row = screen.getByTestId("row");
    expect(row.className).toContain("hover:bg-surface-hover");
    expect(screen.getByText("$4,976.85").className).toContain("font-mono");
    expect(screen.getByText("Apple Inc.").className).toContain("text-muted-foreground");
  });

  it("text cells are sans, figure cells mono", () => {
    render(
      <RowGrid columns="1fr">
        <DataRow>
          <RowCell variant="text" primary="Apple" />
        </DataRow>
      </RowGrid>,
    );
    expect(screen.getByText("Apple").className).not.toContain("font-mono");
  });
});
