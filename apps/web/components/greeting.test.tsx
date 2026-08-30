import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useSession = vi.fn<() => { data: { user: { name: string } } | null }>();
vi.mock("../lib/auth-client", () => ({
  authClient: { useSession: () => useSession() },
}));

import { Greeting } from "./greeting";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Greeting", () => {
  it("greets by time of day with the first name", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T09:00:00"));
    useSession.mockReturnValue({ data: { user: { name: "Robin Ashcroft" } } });

    render(<Greeting />);
    expect(screen.getByRole("heading", { name: "Good morning, Robin" })).toBeInTheDocument();
  });

  it("greets without a name while the session loads", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T20:00:00"));
    useSession.mockReturnValue({ data: null });

    render(<Greeting />);
    expect(screen.getByRole("heading", { name: "Good evening" })).toBeInTheDocument();
  });

  it("says good afternoon between 12 and 17", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T13:00:00"));
    useSession.mockReturnValue({ data: { user: { name: "Robin" } } });

    render(<Greeting />);
    expect(screen.getByRole("heading", { name: "Good afternoon, Robin" })).toBeInTheDocument();
  });
});
