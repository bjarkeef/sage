import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState } from "./states";

describe("EmptyState", () => {
  it("renders a status message and optional action", () => {
    render(<EmptyState message="No positions yet." action={<button>Add one</button>} />);
    expect(screen.getByRole("status")).toHaveTextContent("No positions yet.");
    expect(screen.getByRole("button", { name: "Add one" })).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("renders an alert with a retry button", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Could not load holdings." onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load holdings.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("omits the button without onRetry", () => {
    render(<ErrorState message="Nope." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
