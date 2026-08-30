import { describe, it, expect } from "vitest";
import { Decimal, ROUNDING_MODES, DEFAULT_ROUNDING } from "./decimal";

describe("Decimal engine", () => {
  it("keeps addition exact", () => {
    expect(new Decimal("0.1").plus("0.2").toString()).toBe("0.3");
  });

  it("keeps multiplication exact", () => {
    expect(new Decimal("0.12345").times("17").toString()).toBe("2.09865");
  });

  it("rounds half-even by default at a given scale", () => {
    expect(new Decimal("2.5").toDecimalPlaces(0).toString()).toBe("2");
    expect(new Decimal("3.5").toDecimalPlaces(0).toString()).toBe("4");
  });

  it("never emits exponential notation for realistic magnitudes", () => {
    expect(new Decimal("0.0000001").toFixed()).toBe("0.0000001");
    expect(new Decimal("123456789012345").toFixed()).toBe("123456789012345");
  });

  it("exposes rounding-mode mapping defaulting to half-even", () => {
    expect(DEFAULT_ROUNDING).toBe("half-even");
    expect(ROUNDING_MODES[DEFAULT_ROUNDING]).toBe(6);
    expect(ROUNDING_MODES["half-up"]).toBe(4);
  });
});
