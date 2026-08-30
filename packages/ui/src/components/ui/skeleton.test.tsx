import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders an aria-hidden shimmer block", () => {
    const { container } = render(<Skeleton className="h-4 w-24" />);
    const el = container.firstElementChild!;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toContain("skeleton");
    expect(el.className).toContain("h-4");
  });
});
