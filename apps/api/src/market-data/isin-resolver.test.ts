import { describe, it, expect } from "vitest";
import { pickPrimaryListing } from "./isin-resolver";

describe("pickPrimaryListing", () => {
  it("picks US over XETRA", () => {
    const listings = [
      { code: "NECKAR", exchange: "XETRA", hasPrice: true },
      { code: "AAPL", exchange: "US", hasPrice: true },
    ];
    expect(pickPrimaryListing(listings)).toBe("AAPL");
  });

  it("picks XETRA over Frankfurt", () => {
    const listings = [
      { code: "NECKAR", exchange: "F", hasPrice: true },
      { code: "NECKAR", exchange: "XETRA", hasPrice: true },
    ];
    expect(pickPrimaryListing(listings)).toBe("NECKAR.DE");
  });

  it("picks Stockholm over Milan", () => {
    const listings = [
      { code: "NECKAR", exchange: "MI", hasPrice: true },
      { code: "NORDLAS-B", exchange: "ST", hasPrice: true },
    ];
    expect(pickPrimaryListing(listings)).toBe("NORDLAS-B.ST");
  });

  it("returns the first listing when no exchange matches the priority list", () => {
    const listings = [
      { code: "FOO", exchange: "XXXX", hasPrice: true },
      { code: "BAR", exchange: "YYYY", hasPrice: true },
    ];
    expect(pickPrimaryListing(listings)).toBe("FOO.XXXX");
  });

  it("returns null for empty listings", () => {
    expect(pickPrimaryListing([])).toBeNull();
  });

  it("prefers listings with price data", () => {
    const listings = [
      { code: "FOO", exchange: "US", hasPrice: false },
      { code: "BAR", exchange: "XETRA", hasPrice: true },
    ];
    expect(pickPrimaryListing(listings)).toBe("BAR.DE");
  });

  it("falls back to priceless listings when none have price data", () => {
    const listings = [{ code: "FOO", exchange: "US", hasPrice: false }];
    expect(pickPrimaryListing(listings)).toBe("FOO");
  });
});
