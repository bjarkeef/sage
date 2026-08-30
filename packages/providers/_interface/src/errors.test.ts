import { describe, it, expect } from "vitest";
import {
  ProviderError,
  SymbolNotFoundError,
  ProviderRateLimitError,
  ProviderAuthError,
  ProviderUnavailableError,
} from "./errors";

describe("provider errors", () => {
  it("SymbolNotFoundError carries the symbol and extends ProviderError", () => {
    const e = new SymbolNotFoundError("AAPL");
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("SymbolNotFoundError");
    expect(e.symbol).toBe("AAPL");
    expect(e.message).toContain("AAPL");
  });

  it("ProviderRateLimitError carries optional retryAfterSeconds", () => {
    expect(new ProviderRateLimitError()).toBeInstanceOf(ProviderError);
    expect(new ProviderRateLimitError().message).toContain("rate limit");
    const e = new ProviderRateLimitError(30);
    expect(e.retryAfterSeconds).toBe(30);
    expect(e.message).toContain("30");
  });

  it("ProviderAuthError has a default message and accepts a custom one", () => {
    expect(new ProviderAuthError()).toBeInstanceOf(ProviderError);
    expect(new ProviderAuthError().name).toBe("ProviderAuthError");
    expect(new ProviderAuthError("bad key").message).toBe("bad key");
  });

  it("ProviderUnavailableError supports a cause and default message", () => {
    const cause = new Error("network down");
    const e = new ProviderUnavailableError("down", { cause });
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.cause).toBe(cause);
    expect(e.name).toBe("ProviderUnavailableError");
    expect(new ProviderUnavailableError().message).toContain("unavailable");
  });
});
