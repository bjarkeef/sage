import { describe, it, expect } from "vitest";
import { countryNameToIso } from "./country-iso";

/**
 * These names were sampled from live Yahoo `assetProfile` responses, not taken
 * from the ISO register — Yahoo says "South Korea", not "Korea, Republic of".
 * The whole region gap was this one field coming back null.
 */
describe("countryNameToIso", () => {
  it.each([
    ["United States", "US"],
    ["Canada", "CA"],
    ["United Kingdom", "GB"],
    ["Germany", "DE"],
    ["Switzerland", "CH"],
    ["Netherlands", "NL"],
    ["Japan", "JP"],
    ["Australia", "AU"],
    ["Taiwan", "TW"],
  ])("resolves %s, observed live, to %s", (name, iso) => {
    expect(countryNameToIso(name)).toBe(iso);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(countryNameToIso("  united KINGDOM ")).toBe("GB");
  });

  it("accepts the alternative spellings a different endpoint might use", () => {
    expect(countryNameToIso("United States of America")).toBe("US");
    expect(countryNameToIso("Korea, Republic of")).toBe("KR");
    expect(countryNameToIso("Czech Republic")).toBe("CZ");
  });

  /** A wrong region is worse than an absent one: an unrecognised name has to
   *  read as Unknown, which this app shows in plain sight, rather than being
   *  guessed into a bucket. */
  it("returns null rather than guessing at an unknown name", () => {
    expect(countryNameToIso("Ruritania")).toBeNull();
  });

  it.each([null, undefined, ""])("returns null for %s", (value) => {
    expect(countryNameToIso(value)).toBeNull();
  });
});
