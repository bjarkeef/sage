import { describe, it, expect } from "vitest";
import { CERTAINTY_FILL, CERTAINTY_STROKE } from "./certainty-bars";

describe("certainty-bars tokens", () => {
  // The alpha ramp failed precisely because three "different" fills resolved to
  // near-identical colour. Assert distinctness, not literals.
  it("gives each certainty level a distinct fill", () => {
    const values = Object.values(CERTAINTY_FILL);
    expect(new Set(values).size).toBe(3);
  });

  it("takes every fill from a token, not a color-mix on the brand hue", () => {
    for (const v of Object.values(CERTAINTY_FILL)) {
      expect(v).toMatch(/^var\(--certainty-/);
      expect(v).not.toContain("color-mix");
      expect(v).not.toContain("--primary");
    }
  });

  it("outlines the estimated level and only that level", () => {
    expect(CERTAINTY_STROKE.estimated).toMatch(/^var\(--certainty-/);
    expect(CERTAINTY_STROKE.paid).toBeUndefined();
    expect(CERTAINTY_STROKE.confirmed).toBeUndefined();
  });
});
