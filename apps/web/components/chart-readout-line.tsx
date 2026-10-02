import type { ReactNode } from "react";
import { cn, Delta, toneForValue } from "@sage/ui";
import { formatDate } from "../lib/format";
import { signedPct } from "../lib/asset-page/labels";
import type { ChartReadout } from "../lib/asset-chart/readout";

function Pct({ value }: { value: number }) {
  const tone = toneForValue(Number(value.toFixed(1)));
  return (
    <span
      data-tone={tone}
      className={cn(
        "tabular-nums transition-colors duration-200",
        tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-neutral",
      )}
    >
      {signedPct(value)}
    </span>
  );
}

/**
 * The line under the header price: how the selected range went, or how it had
 * gone by the hovered day. Figures change the instant the day changes (DESIGN.md
 * Motion: no tweening under a moving pointer); only a sign change cross-fades
 * its colour.
 */
export function ChartReadoutLine({ readout }: { readout: ChartReadout }) {
  const when = readout.date
    ? `to ${formatDate(readout.date, { year: "always" })}`
    : readout.rangePhrase;
  const c = readout.compare;
  let line: ReactNode = null;
  if (c && c.status === "ready" && c.youPct != null && c.benchmarkPct != null) {
    line = (
      <>
        You <Pct value={c.youPct} /> · {c.name} <Pct value={c.benchmarkPct} /> {when}
      </>
    );
  } else if (readout.totalReturnPct != null && readout.price) {
    line = (
      <>
        <Pct value={readout.totalReturnPct} /> with dividends · <Pct value={readout.price.pct} />{" "}
        price {when}
      </>
    );
  } else if (readout.price) {
    line = (
      <>
        <Delta
          className="transition-colors duration-200"
          value={readout.price.abs}
          percent={readout.price.pct}
          currency={readout.currency}
        />{" "}
        {when}
      </>
    );
  }
  return (
    <div data-testid="chart-readout" className="mt-1 text-sm text-muted-foreground">
      {line && <div>{line}</div>}
      {c?.status === "unavailable" && c.reason && <div className="mt-0.5 text-xs">{c.reason}</div>}
    </div>
  );
}
