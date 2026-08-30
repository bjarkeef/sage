import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SageMark } from "./sage-mark";

describe("SageMark", () => {
  it("renders an SVG with the default size", () => {
    const { container } = render(<SageMark />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("22");
    expect(svg?.getAttribute("height")).toBe("22");
  });

  it("accepts a custom size", () => {
    const { container } = render(<SageMark size={32} />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("32");
  });

  it("is aria-hidden for decorative use", () => {
    const { container } = render(<SageMark />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("inherits its colour from the container by default", () => {
    // The error pages and 404 tint the whole mark by setting a text colour on
    // it; a hardcoded fill there would leave the logo bright on a muted page.
    const { container } = render(<SageMark />);
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
    expect(container.querySelector("circle")?.getAttribute("fill")).toBe("currentColor");
  });

  it("tints only the seed when an accent is given", () => {
    // The two-tone brand: bowl in the foreground colour, seed in sage. Filling
    // both with the accent would make it a solid green blob at 19px.
    const { container } = render(<SageMark color="#111" accent="#86ab7c" />);
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("#111");
    expect(container.querySelector("circle")?.getAttribute("fill")).toBe("#86ab7c");
  });

  it("draws solid shapes, not strokes", () => {
    // Why the mark changed: 1.4-wide strokes on a 24 viewBox land near a single
    // device pixel at the 19px the sidebar renders it, so the old sprout thinned
    // to grey hairlines. Fills survive being small.
    const { container } = render(<SageMark />);
    expect(container.querySelector("[stroke-width]")).toBeNull();
  });
});
