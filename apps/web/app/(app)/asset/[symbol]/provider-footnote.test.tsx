import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProviderFootnote } from "./provider-footnote";

describe("ProviderFootnote", () => {
  it("dates both the profile figures and the analysts", () => {
    render(
      <ProviderFootnote
        hasProfileFigures
        profileAsOf="2026-06-15"
        hasRatings
        ratingsAsOf="2026-06-14T08:00:00.000Z"
      />,
    );
    expect(screen.getByText(/provider's snapshot from Jun 15, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Analyst ratings as of Jun 14, 2026/)).toBeInTheDocument();
  });

  it("mentions only the profile figures when there are no ratings", () => {
    render(
      <ProviderFootnote
        hasProfileFigures
        profileAsOf="2026-06-15"
        hasRatings={false}
        ratingsAsOf={null}
      />,
    );
    expect(screen.getByText(/snapshot from Jun 15, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Analyst ratings/)).not.toBeInTheDocument();
  });

  it("says the analysts' date is unknown when ratings show without one", () => {
    render(
      <ProviderFootnote
        hasProfileFigures={false}
        profileAsOf={null}
        hasRatings
        ratingsAsOf={null}
      />,
    );
    expect(screen.getByText("Analyst ratings: date unknown.")).toBeInTheDocument();
    expect(screen.queryByText(/snapshot/)).not.toBeInTheDocument();
  });

  it("says the snapshot's date is unknown when profile figures show without one", () => {
    render(
      <ProviderFootnote
        hasProfileFigures
        profileAsOf={null}
        hasRatings={false}
        ratingsAsOf={null}
      />,
    );
    expect(screen.getByText(/its date is unknown/)).toBeInTheDocument();
  });

  it("renders nothing when no provider figure is shown", () => {
    const { container } = render(
      <ProviderFootnote
        hasProfileFigures={false}
        profileAsOf={null}
        hasRatings={false}
        ratingsAsOf={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
