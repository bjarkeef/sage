import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StalePricesCallout } from "./stale-prices-callout";

describe("StalePricesCallout", () => {
  it("renders nothing when every price is current", () => {
    const { container } = render(<StalePricesCallout stale={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says a holding is valued at an old close when nothing newer exists", () => {
    const { container } = render(
      <StalePricesCallout stale={[{ symbol: "OLDCO", asOf: "2026-08-12", quotedToday: false }]} />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/OLDCO is priced from/);
    expect(text).toMatch(/still counted/i);
  });

  /** Its bars stopped, but today's figure uses a live quote. "Priced from" an
   *  August date would be false about the number above the chart. */
  it("says only the chart history is behind when the holding has a current quote", () => {
    const { container } = render(
      <StalePricesCallout stale={[{ symbol: "LAGCO", asOf: "2026-08-12", quotedToday: true }]} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/priced from/);
    expect(text).toMatch(/chart history for LAGCO stops/i);
    expect(text).toMatch(/current price/i);
  });

  it("keeps the two cases apart when both occur", () => {
    const { container } = render(
      <StalePricesCallout
        stale={[
          { symbol: "OLDCO", asOf: "2026-08-12", quotedToday: false },
          { symbol: "LAGCO", asOf: "2026-08-20", quotedToday: true },
        ]}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/OLDCO is priced from/);
    expect(text).toMatch(/chart history for LAGCO stops/i);
  });
});
