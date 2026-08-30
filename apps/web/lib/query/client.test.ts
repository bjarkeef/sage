// @vitest-environment jsdom
// These exercise the browser branch, which keys off `typeof window`.
import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { makeQueryClient, getQueryClient } from "./client";

describe("query client", () => {
  it("makeQueryClient sets the SSR-safe default staleTime", () => {
    const qc = makeQueryClient();
    expect(qc).toBeInstanceOf(QueryClient);
    expect(qc.getDefaultOptions().queries?.staleTime).toBe(60_000);
  });

  it("getQueryClient returns a stable singleton in the browser", () => {
    // jsdom => isServer is false, so this exercises the browser branch
    expect(getQueryClient()).toBe(getQueryClient());
  });
});
