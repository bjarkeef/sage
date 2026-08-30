import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithClient } from "../lib/test/render-with-client";
import { AppPageHeader } from "./app-page-header";
import { DisplayCurrencyProvider } from "./display-currency-context";

// CurrencyPicker calls useQueryClient, so every render needs a QueryClient
// above it — renderWithClient supplies one (see lib/test/render-with-client.tsx).
describe("AppPageHeader", () => {
  it("renders the currency picker inside the header's actions row", () => {
    renderWithClient(
      <DisplayCurrencyProvider value="USD">
        <AppPageHeader title="Holdings" actions={<button type="button">Add</button>} />
      </DisplayCurrencyProvider>,
    );
    const header = screen.getByRole("heading", { name: "Holdings" }).closest("div")!.parentElement!;
    expect(header).toHaveTextContent("USD");
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("shows Native when no display currency is set", () => {
    renderWithClient(
      <DisplayCurrencyProvider value={null}>
        <AppPageHeader title="Goal" />
      </DisplayCurrencyProvider>,
    );
    expect(screen.getByText("Native")).toBeInTheDocument();
  });
});
