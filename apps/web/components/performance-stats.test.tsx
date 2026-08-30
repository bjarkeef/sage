import { describe, expect, it } from "vitest";
import { formatRate } from "./performance-stats";

describe("formatRate", () => {
  it("formats decimals as signed percentages, null as em dash", () => {
    expect(formatRate(0.1432)).toBe("+14.3%");
    expect(formatRate(-0.05)).toBe("-5.0%");
    expect(formatRate(null)).toBe("—");
    expect(formatRate(0.182, { sign: false })).toBe("18.2%");
  });
});
