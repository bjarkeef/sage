import { describe, it, expect } from "vitest";
import {
  ProviderError,
  SymbolNotFoundError,
  ProviderRateLimitError,
  ProviderAuthError,
  ProviderUnavailableError,
  countryNameToIso,
} from "./index";
import { FakeMarketDataProvider } from "./testing/index";

describe("@sage/provider-interface public surface", () => {
  it("exports the provider error taxonomy", () => {
    expect(new SymbolNotFoundError("x")).toBeInstanceOf(ProviderError);
    expect(new ProviderRateLimitError()).toBeInstanceOf(ProviderError);
    expect(new ProviderAuthError()).toBeInstanceOf(ProviderError);
    expect(new ProviderUnavailableError()).toBeInstanceOf(ProviderError);
  });

  it("exports a usable FakeMarketDataProvider from ./testing", async () => {
    const p = new FakeMarketDataProvider();
    expect(await p.searchSymbol("anything")).toEqual([]);
  });
});

describe("shared country table", () => {
  it("is exported from the package root for every adapter to use", () => {
    expect(countryNameToIso("Denmark")).toBe("DK");
  });
});
