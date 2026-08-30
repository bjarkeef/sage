import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

describe("Table", () => {
  it("renders headers and cells", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>AAPL</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByText("Symbol")).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });
});
