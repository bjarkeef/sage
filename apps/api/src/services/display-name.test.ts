import { describe, it, expect } from "vitest";
import { resolveDisplayName } from "./display-name";

describe("resolveDisplayName", () => {
  it("keeps a real stored name", () => {
    expect(resolveDisplayName("THAMES.L", "Thames Water plc", null)).toBe("Thames Water plc");
  });

  it("falls back to the profile name when the stored name echoes the ticker root", () => {
    // The measured case: instrument.name = "DUOMO" for symbol "DUOMO.MI".
    expect(resolveDisplayName("DUOMO.MI", "DUOMO", "Duomo Industrials SpA")).toBe(
      "Duomo Industrials SpA",
    );
  });

  it("falls back to the profile name when the stored name is the whole symbol", () => {
    expect(resolveDisplayName("NORDA-B", "NORDA-B", "Norda Bank A/S")).toBe("Norda Bank A/S");
  });

  it("returns the symbol when neither source has a real name", () => {
    // The symbol, not the root — Task 2 tests `name === symbol`.
    expect(resolveDisplayName("DUOMO.MI", "DUOMO", null)).toBe("DUOMO.MI");
  });

  it("ignores a profile name that is itself an echo", () => {
    expect(resolveDisplayName("DUOMO.MI", "DUOMO", "DUOMO")).toBe("DUOMO.MI");
  });

  it("handles a suffixless symbol with no name anywhere", () => {
    expect(resolveDisplayName("ACME", null, null)).toBe("ACME");
  });

  it("is case- and whitespace-insensitive when detecting an echo", () => {
    expect(resolveDisplayName("DUOMO.MI", "  duomo  ", null)).toBe("DUOMO.MI");
  });
});
