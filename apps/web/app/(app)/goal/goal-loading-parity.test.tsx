import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import GoalLoading from "./loading";
import { GoalPageSkeleton } from "../../../components/skeletons";

describe("/goal loading parity", () => {
  it("shows the same shape from the route file and the in-page branch", () => {
    // Before this fix, a single navigation showed three shapes in sequence: a
    // 380px card beside a chart from loading.tsx, then six avatar rows from
    // the page's own isLoading branch, then a twelve-column grid when data
    // landed. Both loading.tsx and the in-page branch now render the same
    // GoalPageSkeleton, so this can only pass if they stay in sync.
    const route = render(<GoalLoading />).container.querySelector("[data-skeleton-shape]");
    const inPage = render(<GoalPageSkeleton />).container.querySelector("[data-skeleton-shape]");
    expect(route).not.toBeNull();
    expect(inPage).not.toBeNull();
    expect(route?.getAttribute("data-skeleton-shape")).toBe(
      inPage?.getAttribute("data-skeleton-shape"),
    );
  });
});
