"use client";

import * as React from "react";
import { Delta, DataRow, RowCell, RowGrid, RowHeader, Stat, StatStrip } from "@sage/ui";
import { formatDate, formatMoney } from "../../../../lib/format";
import { analystUpside } from "../../../../lib/asset-page/figures";
import type {
  AnalystConsensusDTO,
  AnalystRatingsDTO,
  AssetDetailDTO,
  MoneyDTO,
} from "../../../../lib/types";

export const CONSENSUS: Record<
  AnalystConsensusDTO,
  { label: string; tone: "gain" | "neutral" | "loss" }
> = {
  strongBuy: { label: "Strong buy", tone: "gain" },
  buy: { label: "Buy", tone: "gain" },
  hold: { label: "Hold", tone: "neutral" },
  sell: { label: "Sell", tone: "loss" },
  strongSell: { label: "Strong sell", tone: "loss" },
};

// Diverging buy→sell scale from semantic tokens; lighter mid-tones keep the two
// ends dominant.
const SEGMENTS = [
  { key: "strongBuy", label: "Strong buy", cls: "bg-gain" },
  { key: "buy", label: "Buy", cls: "bg-gain/50" },
  { key: "hold", label: "Hold", cls: "bg-muted-foreground/30" },
  { key: "sell", label: "Sell", cls: "bg-loss/50" },
  { key: "strongSell", label: "Strong sell", cls: "bg-loss" },
] as const;

const HISTORY_PREVIEW = 6;
const num = (m: MoneyDTO | null): number | null => (m ? Number(m.amount) : null);

function actionTone(action: string): string {
  if (action === "up") return "text-gain";
  if (action === "down") return "text-loss";
  return "text-foreground";
}

/**
 * The analysts' detail, inside Buy more?: the buy→sell spread, the target range
 * with today's price on it, and the rating changes. "Today" is the page
 * header's quote. The provider's own `currentPrice` is not read anywhere — it
 * is how this card once printed a second, different current price.
 */
export function AnalystDetail({
  ratings,
  quote,
}: {
  ratings: AnalystRatingsDTO;
  quote: AssetDetailDTO["quote"];
}) {
  const [showAll, setShowAll] = React.useState(false);
  return (
    <div className="space-y-8">
      <Distribution ratings={ratings} />
      <PriceTargets ratings={ratings} quote={quote} />
      {ratings.upgradeHistory.length > 0 && (
        <div>
          <RowGrid columns="minmax(0,1fr) minmax(0,1.2fr) 7rem">
            <RowHeader cells={["Firm", "Rating", "Date"]} align={["left", "left", "right"]} />
            {(showAll
              ? ratings.upgradeHistory
              : ratings.upgradeHistory.slice(0, HISTORY_PREVIEW)
            ).map((h, i) => (
              <DataRow key={`${h.firm}-${h.date}-${i}`}>
                <RowCell variant="text" primary={h.firm} />
                <RowCell
                  variant="text"
                  primary={
                    <span className={actionTone(h.action)}>
                      {h.fromGrade ? `${h.fromGrade} → ${h.toGrade}` : h.toGrade}
                    </span>
                  }
                />
                <RowCell
                  align="right"
                  primary={formatDate(h.date.slice(0, 10), { year: "always" })}
                />
              </DataRow>
            ))}
          </RowGrid>
          {ratings.upgradeHistory.length > HISTORY_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              {showAll ? "Show less" : `Show all ${ratings.upgradeHistory.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Distribution({ ratings }: { ratings: AnalystRatingsDTO }) {
  const dist = ratings.distribution;
  const total = SEGMENTS.reduce((s, seg) => s + dist[seg.key], 0);
  if (total === 0) return null;
  const nonzero = SEGMENTS.filter((seg) => dist[seg.key] > 0);
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full">
        {nonzero.map((seg) => (
          <div
            key={seg.key}
            className={seg.cls}
            style={{ width: `${(dist[seg.key] / total) * 100}%` }}
            title={`${seg.label}: ${dist[seg.key]}`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {ratings.analystCount > 0 && (
          <span className="text-foreground">{ratings.analystCount} analysts</span>
        )}
        {nonzero.map((seg) => (
          <span key={seg.key}>
            {" · "}
            {seg.label} {dist[seg.key]}
          </span>
        ))}
      </p>
    </div>
  );
}

function PriceTargets({
  ratings,
  quote,
}: {
  ratings: AnalystRatingsDTO;
  quote: AssetDetailDTO["quote"];
}) {
  const { low, mean, high } = ratings.targets;
  const lowN = num(low);
  const meanN = num(mean);
  const highN = num(high);
  if (lowN == null && meanN == null && highN == null) return null;

  const sameCurrency = quote != null && (!low || low.currency === quote.price.currency);
  const curN = sameCurrency && quote ? Number(quote.price.amount) : null;
  const upside = analystUpside(mean, quote);
  const showTrack = lowN != null && highN != null && curN != null && quote != null && highN > lowN;
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - lowN!) / (highN! - lowN!)) * 100));

  return (
    <div className="space-y-4">
      <StatStrip>
        <Stat size="sm" label="Low" value={low ? formatMoney(low) : "—"} />
        <Stat size="sm" label="Average" value={mean ? formatMoney(mean) : "—"} />
        <Stat size="sm" label="High" value={high ? formatMoney(high) : "—"} />
      </StatStrip>
      {showTrack && (
        <div>
          <div className="relative h-2.5 rounded-full bg-hairline">
            {meanN != null && (
              <span
                className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-muted-foreground"
                style={{ left: `${pos(meanN)}%` }}
                title="Average target"
              />
            )}
            <span
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
              style={{ left: `${pos(curN)}%` }}
              title="Today's price"
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{`Today ${formatMoney(quote.price)}`}</span>
            {upside.ok && (
              <span className="flex items-center gap-1">
                <Delta
                  value={upside.value.abs}
                  percent={upside.value.pct}
                  currency={upside.value.currency}
                />
                to average
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
