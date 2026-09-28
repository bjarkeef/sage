import { describe, it, expect } from "vitest";
import * as React from "react";
import { render } from "@testing-library/react";
import { TapeChart } from "./tape-chart";
import { isoToDay, type TapePoint } from "../../../lib/income-tape/points";
import { indexBySymbol, monthTotals } from "../../../lib/income-tape/aggregates";
import { fitView } from "../../../lib/income-tape/viewport";

function p(
  iso: string,
  symbol: string,
  amount: number,
  certainty: TapePoint["certainty"],
): TapePoint {
  return { day: isoToDay(iso), iso, symbol, amount, certainty, headline: null };
}
const today = isoToDay("2026-09-28");
const PTS = [
  p("2025-06-10", "KO", 90, "paid"),
  p("2026-06-12", "KO", 99, "paid"),
  p("2026-10-15", "O", 32, "confirmed"),
  p("2027-06-11", "KO", 104, "estimated"),
];
const extent = { firstDay: PTS[0]!.day, lastDay: PTS.at(-1)!.day };

function draw(over: Partial<React.ComponentProps<typeof TapeChart>> = {}) {
  const worldRef = React.createRef<SVGGElement>();
  return render(
    <TapeChart
      points={PTS}
      index={indexBySymbol(PTS)}
      extent={extent}
      todayDay={today}
      view={fitView(extent.firstDay, extent.lastDay + 1, 1096)}
      width={1096}
      height={434}
      focus={null}
      hover={null}
      months={monthTotals(PTS, null)}
      entering={false}
      worldRef={worldRef}
      {...over}
    />,
  );
}

describe("TapeChart", () => {
  it("draws one bar per payment in its certainty tone", () => {
    const { container } = draw();
    const bars = [...container.querySelectorAll("rect[data-bar]")];
    expect(bars).toHaveLength(4);
    expect(bars.map((b) => b.getAttribute("fill"))).toEqual([
      "var(--certainty-paid)",
      "var(--certainty-paid)",
      "var(--certainty-confirmed)",
      "var(--certainty-estimated)",
    ]);
  });

  it("dims other bars under hover and fades other payers under focus", () => {
    const hovered = draw({ hover: PTS[1]! }).container;
    const hb = [...hovered.querySelectorAll<SVGRectElement>("rect[data-bar]")];
    expect(hb.map((b) => b.style.opacity)).toEqual(["0.4", "1", "0.4", "0.4"]);

    const focused = draw({ focus: "KO" }).container;
    const fb = [...focused.querySelectorAll<SVGRectElement>("rect[data-bar]")];
    expect(fb.map((b) => b.style.opacity)).toEqual(["1", "1", "0.12", "1"]);
  });

  it("draws a ghost outline beside each focused payment that had one a year earlier", () => {
    const { container } = draw({ focus: "KO" });
    // 2026-06 has 2025-06; 2027-06 has 2026-06; 2025-06 has none.
    expect(container.querySelectorAll("rect[data-ghost]")).toHaveLength(2);
  });

  it("labels the focused payer's payments with their change on last year", () => {
    const { container } = draw({ focus: "KO" });
    expect(container.textContent).toContain("+10.0%");
  });

  it("hides labels during the entrance", () => {
    const { container } = draw({ entering: true });
    expect(container.querySelectorAll("[data-label]")).toHaveLength(0);
  });
});
