import { describe, it, expect } from "vitest";
import { CERTAINTY_FILL } from "./certainty-bars";

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

  // Estimated used to carry a faint fill plus a dashed outline — the outline
  // was what made it legible. At real (thin, twelve-bar) chart scale that
  // read as a row of near-empty boxes, so estimated is solid again, same as
  // paid and confirmed: no separate stroke token to pin here anymore.
  it("gives estimated the same solid treatment as paid and confirmed", () => {
    expect(CERTAINTY_FILL.estimated).toBe("var(--certainty-estimated)");
  });
});
