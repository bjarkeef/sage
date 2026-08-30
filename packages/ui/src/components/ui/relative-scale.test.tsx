import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RelativeScale, scalePosition } from "./relative-scale";

describe("scalePosition", () => {
  it("puts parity with the benchmark dead centre", () => {
    expect(scalePosition(1).position).toBeCloseTo(0.5, 6);
    expect(scalePosition(1).clamped).toBe(false);
  });

  it("places half and double the benchmark equidistant from centre", () => {
    const half = scalePosition(0.5).position;
    const double = scalePosition(2).position;
    expect(0.5 - half).toBeCloseTo(double - 0.5, 6);
    expect(half).toBeCloseTo(0.25, 6);
    expect(double).toBeCloseTo(0.75, 6);
  });

  it("spans two doublings either side of parity", () => {
    expect(scalePosition(0.25).position).toBeCloseTo(0, 6);
    expect(scalePosition(4).position).toBeCloseTo(1, 6);
  });

  it("keeps a real dividend book on the scale rather than clamped to the edges", () => {
    // The figures that exposed the too-narrow first domain: beta 0.43,
    // volatility 2.26x the index, a drawdown 2.76x as deep.
    for (const ratio of [0.43, 2.26, 2.76]) {
      const { position, clamped } = scalePosition(ratio);
      expect(clamped).toBe(false);
      expect(position).toBeGreaterThan(0);
      expect(position).toBeLessThan(1);
    }
  });

  it("is logarithmic, not linear — 0.75x sits nearer centre than linear would", () => {
    // Linear over [0.25, 4] would put 0.75x at (0.75 − 0.25) / 3.75 ≈ 0.133.
    expect(scalePosition(0.75).position).toBeGreaterThan(0.35);
  });

  it("clamps beyond the domain and says so", () => {
    expect(scalePosition(9)).toEqual({ position: 1, clamped: true });
    expect(scalePosition(0.05)).toEqual({ position: 0, clamped: true });
  });

  it("treats a non-positive or non-finite ratio as clamped at the low end", () => {
    expect(scalePosition(0)).toEqual({ position: 0, clamped: true });
    expect(scalePosition(Number.NaN)).toEqual({ position: 0, clamped: true });
  });

  it("does not call the domain edges themselves clamped", () => {
    expect(scalePosition(0.25).clamped).toBe(false);
    expect(scalePosition(4).clamped).toBe(false);
  });
});

describe("RelativeScale", () => {
  it("exposes the sentence, not the graphic, to assistive tech", () => {
    render(
      <RelativeScale ratio={0.8} pinLabel="S&P 500" srLabel="20% less volatile than the S&P 500" />,
    );
    expect(
      screen.getByRole("img", { name: "20% less volatile than the S&P 500" }),
    ).toBeInTheDocument();
  });

  it("labels the centre pin with the benchmark", () => {
    render(<RelativeScale ratio={0.8} pinLabel="S&P 500" srLabel="less volatile" />);
    expect(screen.getByText("S&P 500")).toBeInTheDocument();
  });

  it("marks a clamped marker so an off-scale value is not read as on-scale", () => {
    const { container } = render(
      <RelativeScale ratio={5} pinLabel="S&P 500" srLabel="far more volatile" />,
    );
    expect(container.querySelector('[data-clamped="true"]')).not.toBeNull();
  });

  it("does not mark an in-domain marker as clamped", () => {
    const { container } = render(
      <RelativeScale ratio={1.2} pinLabel="S&P 500" srLabel="slightly more volatile" />,
    );
    expect(container.querySelector('[data-clamped="true"]')).toBeNull();
  });
});
