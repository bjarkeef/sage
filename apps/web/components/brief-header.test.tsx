import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BriefSegment } from "../lib/brief";

const useSession = vi.fn<() => { data: { user: { name: string } } | null }>();
vi.mock("../lib/auth-client", () => ({
  authClient: { useSession: () => useSession() },
}));

import { BriefHeader } from "./brief-header";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  cleanup();
});

const SEGMENTS: BriefSegment[] = [
  { kind: "text", text: "Your portfolio stands at " },
  { kind: "value", text: "$12,345.00", tone: "neutral" },
  { kind: "text", text: " — " },
  { kind: "value", text: "+$120.00 (+1.25 %)", tone: "gain" },
  { kind: "text", text: " today. " },
  { kind: "value", text: "-$40.00", tone: "loss" },
  { kind: "text", text: " " },
  { kind: "value", text: "$10.00", tone: "income" },
];

describe("BriefHeader", () => {
  it("renders the hydration-safe greeting heading with the session name", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T09:00:00"));
    useSession.mockReturnValue({ data: { user: { name: "Robin Ashcroft" } } });

    render(
      <BriefHeader segments={SEGMENTS} marketStateEnabled={false} todayChangePercent={null} />,
    );

    expect(screen.getByRole("heading", { name: "Good morning, Robin" })).toBeInTheDocument();
  });

  it("greets without a name while the session loads", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T20:00:00"));
    useSession.mockReturnValue({ data: null });

    render(
      <BriefHeader segments={SEGMENTS} marketStateEnabled={false} todayChangePercent={null} />,
    );

    expect(screen.getByRole("heading", { name: "Good evening" })).toBeInTheDocument();
  });

  it("gives value segments sans emphasis (tabular, no mono) plus their tone class", () => {
    useSession.mockReturnValue({ data: null });
    render(
      <BriefHeader segments={SEGMENTS} marketStateEnabled={false} todayChangePercent={null} />,
    );

    // Prose figures are sans + tabular-nums per the DESIGN.md prose rule —
    // mono is reserved for data figures, eyebrows, and chips.
    expect(screen.getByText("$12,345.00")).toHaveClass("tabular-nums", "font-medium");
    expect(screen.getByText("$12,345.00")).not.toHaveClass("font-mono");
    expect(screen.getByText("+$120.00 (+1.25 %)")).toHaveClass("text-gain");
    expect(screen.getByText("-$40.00")).toHaveClass("text-loss");
    expect(screen.getByText("$10.00")).toHaveClass("text-income");
    expect(screen.getByText("$12,345.00")).not.toHaveClass("text-gain", "text-loss", "text-income");
  });

  it("omits the subline when marketStateEnabled is false", () => {
    useSession.mockReturnValue({ data: null });
    render(
      <BriefHeader segments={SEGMENTS} marketStateEnabled={false} todayChangePercent={null} />,
    );

    expect(screen.queryByText(/Markets/)).not.toBeInTheDocument();
  });

  it("renders a subline when marketStateEnabled is true", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00")); // Tuesday, market open hours
    useSession.mockReturnValue({ data: null });

    render(<BriefHeader segments={SEGMENTS} marketStateEnabled={true} todayChangePercent={1.1} />);

    expect(screen.getByText("Markets are open.")).toBeInTheDocument();
  });
});
