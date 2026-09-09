import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  IncomeTimeline,
  timelineTotalLabel,
  timelineReceivedLabel,
  timelineExpectedLabel,
} from "./income-timeline";
import type { TimelinePoint } from "../../lib/dividend-year";

const points = [
  { year: 2024, received: 1000, projected: 0, total: 1000, isCurrentYear: false },
  { year: 2025, received: 1200, projected: 0, total: 1200, isCurrentYear: false },
  { year: 2026, received: 140, projected: 70, total: 210, isCurrentYear: true },
];

// A finished year (nothing left to forecast) beside a year still in
// progress, so the fused-total defect has something to show: fusing
// received + projected into one bar figure would read as money that's
// already arrived when part of it hasn't. Invented round numbers, not
// anyone's actual dividend income.
const pointsWithPartialYear: TimelinePoint[] = [
  { year: 2025, received: 4000, projected: 0, total: 4000, isCurrentYear: false },
  { year: 2026, received: 2800, projected: 1200, total: 4000, isCurrentYear: true },
];

// A current year where the forecast has already fully arrived — late
// December, say. `projected` is 0 exactly like a finished year, so there is
// nothing left to add.
const pointsWithNoExpected: TimelinePoint[] = [
  { year: 2025, received: 4000, projected: 0, total: 4000, isCurrentYear: false },
  { year: 2026, received: 2800, projected: 0, total: 2800, isCurrentYear: true },
];

// The mirror of `pointsWithNoExpected`: a current year that hasn't received
// anything yet — early January, say. `received` is 0 on the segment
// `timelineReceivedLabel` covers, the same way `projected` was 0 above on
// the segment `timelineExpectedLabel` covers.
const pointsWithNothingReceivedYet: TimelinePoint[] = [
  { year: 2025, received: 4000, projected: 0, total: 4000, isCurrentYear: false },
  { year: 2026, received: 0, projected: 1200, total: 1200, isCurrentYear: true },
];

describe("IncomeTimeline", () => {
  it("renders the card with its legend", () => {
    render(<IncomeTimeline points={points} currency="DKK" />);
    // Exact strings, not /received/i: the card's subtitle also reads
    // "Received, and still expected this year", so a loose matcher finds two
    // elements and getByText throws.
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByText("Still expected")).toBeInTheDocument();
  });

  // The chart stops at the current year on purpose. The line says so, and
  // points at the page that does answer the long-horizon question.
  it("says where the horizon ends and links to the goal page", () => {
    render(<IncomeTimeline points={points} currency="DKK" />);
    expect(screen.getByRole("link", { name: /goal/i })).toHaveAttribute("href", "/goal");
  });

  it("renders nothing when no income has ever been recorded", () => {
    const { container } = render(<IncomeTimeline points={[]} currency="DKK" />);
    expect(container.firstChild).toBeNull();
  });

  it("points at settings when income recording is off", () => {
    render(<IncomeTimeline points={[]} currency="DKK" incomeRecordingOff />);
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
  });

  // Recharts never lays out its SVG under jsdom, so the page-level invariant
  // test (analytics.test.tsx) cannot see this card's money figures and so
  // cannot confirm its BasisChip either — this is the real coverage for that
  // gap. `CardTitle` and `BasisChip` are plain DOM, so it sidesteps the
  // Recharts/jsdom limitation entirely rather than working around it.
  it("carries a basis marker in its title row", () => {
    render(<IncomeTimeline points={points} currency="DKK" taxed />);
    expect(screen.getByText("After tax")).toBeInTheDocument();
  });

  it("says before tax when no rate is configured", () => {
    render(<IncomeTimeline points={points} currency="DKK" taxed={false} />);
    expect(screen.getByText("Before tax")).toBeInTheDocument();
  });
});

// Recharts never lays out its SVG under jsdom — `ResponsiveContainer`
// measures 0×0 in this suite's environment (confirmed empirically: rendering
// <IncomeTimeline> here and dumping the DOM shows an empty
// `recharts-responsive-container` div, no <Bar>/<LabelList>/<text> ever
// mounts). A `screen.getByText` on a chart label therefore cannot
// discriminate a working label from a broken one — it fails identically
// whether the feature exists or not, which is exactly the shape of the three
// tests already caught on this branch. The label-text decision is pulled out
// as a pure function per point (matching `forwardBarLabel` in the sibling
// `forward-payments.tsx`) specifically so it can be tested directly.
describe("timeline bar labels", () => {
  it("labels a finished year with its total, and nothing else", () => {
    const [finished] = pointsWithPartialYear;
    expect(timelineTotalLabel(finished)).toBe("4,000");
    expect(timelineReceivedLabel(finished)).toBe("");
    expect(timelineExpectedLabel(finished)).toBe("");
  });

  it("splits the in-progress year into a received figure and an expected addition", () => {
    const [, current] = pointsWithPartialYear;
    // The received segment states what actually arrived.
    expect(timelineReceivedLabel(current)).toBe("2,800");
    // The projected segment states what's still owed, as an addition — never
    // a bare number, which would read as the stack's total.
    expect(timelineExpectedLabel(current)).toBe("+1,200 expected");
    // The fused total must not appear anywhere — it is the defect this task
    // removes. The received-bar's total label is suppressed for this point.
    expect(timelineTotalLabel(current)).toBe("");
  });

  it("renders one label, not an empty addition, when the in-progress year has nothing left expected", () => {
    const [, current] = pointsWithNoExpected;
    // projected is 0, exactly like a finished year: the total label covers
    // it, and the received/expected pair stays silent rather than printing
    // "+0 expected".
    expect(timelineTotalLabel(current)).toBe("2,800");
    expect(timelineReceivedLabel(current)).toBe("");
    expect(timelineExpectedLabel(current)).toBe("");
  });

  it("renders one label, not a stray zero, when the in-progress year has received nothing yet", () => {
    const [, current] = pointsWithNothingReceivedYet;
    // received is 0, mirroring the no-expected case above but on the other
    // segment: without a guard on its own value, Math.round(0).toLocaleString()
    // is "0", and Recharts has no rectangle to place it on (a zero-height
    // stack segment draws nothing — see corners()), so the received segment
    // must stay silent and the expected segment carries the only label.
    expect(timelineReceivedLabel(current)).toBe("");
    expect(timelineExpectedLabel(current)).toBe("+1,200 expected");
    // Still no fused total for this point — it's in progress.
    expect(timelineTotalLabel(current)).toBe("");
  });

  it("suppresses a segment's own label when its figure rounds down to zero, not only when it is exactly zero", () => {
    // The mirror-hole check: a positive `received`/`projected` that rounds
    // to zero is just as meaningless a label as a literal zero, and would
    // slip past a guard that only checked the raw value against 0.
    const nearZeroReceived: TimelinePoint = {
      year: 2026,
      received: 0.4,
      projected: 1200,
      total: 1200.4,
      isCurrentYear: true,
    };
    expect(timelineReceivedLabel(nearZeroReceived)).toBe("");

    const nearZeroExpected: TimelinePoint = {
      year: 2026,
      received: 2800,
      projected: 0.3,
      total: 2800.3,
      isCurrentYear: true,
    };
    expect(timelineExpectedLabel(nearZeroExpected)).toBe("");
  });

  it("returns empty strings for an undefined point (Recharts payload can be undefined mid-render)", () => {
    expect(timelineTotalLabel(undefined)).toBe("");
    expect(timelineReceivedLabel(undefined)).toBe("");
    expect(timelineExpectedLabel(undefined)).toBe("");
  });
});

// Confirms the SAME jsdom limitation the pure-function tests above work
// around: even with the real fixture from the brief, no chart label reaches
// the DOM. This is not a test of the feature — it locks in why the tests
// above are the ones that can actually fail, so a future editor doesn't
// "simplify" this file back to DOM assertions that silently assert nothing.
describe("IncomeTimeline chart labels are unreachable under jsdom", () => {
  it("does not find any bar label text in the rendered tree", () => {
    render(<IncomeTimeline points={pointsWithPartialYear} currency="DKK" />);
    expect(screen.queryByText("2,800")).not.toBeInTheDocument();
    expect(screen.queryByText("+1,200 expected")).not.toBeInTheDocument();
    expect(screen.queryByText("4,000")).not.toBeInTheDocument();
  });
});
