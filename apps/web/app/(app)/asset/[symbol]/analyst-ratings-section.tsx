"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  Skeleton,
  SectionHeader,
  Chip,
  Stat,
  StatStrip,
  Delta,
  RowGrid,
  RowHeader,
  DataRow,
  RowCell,
} from "@sage/ui";
import { getAssetRatings } from "../../../../lib/api";
import { qk } from "../../../../lib/query/keys";
import { formatMoney, formatDate } from "../../../../lib/format";
import type { AnalystRatingsDTO, MoneyDTO } from "../../../../lib/types";

const CONSENSUS: Record<string, { label: string; tone: "gain" | "neutral" | "loss" }> = {
  strongBuy: { label: "Strong buy", tone: "gain" },
  buy: { label: "Buy", tone: "gain" },
  hold: { label: "Hold", tone: "neutral" },
  sell: { label: "Sell", tone: "loss" },
  strongSell: { label: "Strong sell", tone: "loss" },
};

// Diverging buy→sell scale from semantic tokens (no data-palette — these carry
// buy/sell meaning). Lighter mid-tones via opacity keep the two ends dominant.
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

export function AnalystRatingsSection({ slug }: { slug: string }) {
  const { data, isLoading } = useQuery({
    queryKey: qk.assetRatings(slug),
    queryFn: () => getAssetRatings(slug),
    staleTime: 300_000,
  });

  const [showAllHistory, setShowAllHistory] = React.useState(false);

  if (isLoading) return <RatingsSkeleton />;
  if (!data) return null; // no coverage — section absent

  return (
    <section className="mb-10">
      <SectionHeader
        title="Analyst ratings"
        meta={
          data.consensusKey ? (
            <Chip tone={CONSENSUS[data.consensusKey]!.tone}>
              {CONSENSUS[data.consensusKey]!.label}
            </Chip>
          ) : null
        }
      />
      <Card>
        <Distribution ratings={data} />
        <PriceTargets ratings={data} />
        {data.upgradeHistory.length > 0 && (
          <div className="mt-8">
            <RowGrid columns="minmax(0,1fr) minmax(0,1.2fr) 84px">
              <RowHeader cells={["Firm", "Rating", "Date"]} align={["left", "left", "right"]} />
              {(showAllHistory
                ? data.upgradeHistory
                : data.upgradeHistory.slice(0, HISTORY_PREVIEW)
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
                  <RowCell align="right" primary={formatDate(h.date.slice(0, 10))} />
                </DataRow>
              ))}
            </RowGrid>
            {data.upgradeHistory.length > HISTORY_PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAllHistory((v) => !v)}
                className="mt-2 px-3 text-sm text-muted-foreground hover:text-foreground"
              >
                {showAllHistory ? "Show less" : `Show all ${data.upgradeHistory.length} →`}
              </button>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

/** Strong-buy → strong-sell distribution bar + a nonzero-count breakdown line. */
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

/** Low / average / high price targets, with a track placing the current price
 *  within the low→high range and an upside line vs. the average target. */
function PriceTargets({ ratings }: { ratings: AnalystRatingsDTO }) {
  const { low, mean, high } = ratings.targets;
  const lowN = num(low);
  const meanN = num(mean);
  const highN = num(high);
  const curN = num(ratings.currentPrice);
  if (lowN == null && meanN == null && highN == null) return null;

  const showTrack = lowN != null && highN != null && curN != null && highN > lowN;
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - lowN!) / (highN! - lowN!)) * 100));

  return (
    <div className="mt-8 space-y-4">
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
              title="Current price"
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>Current {formatMoney(ratings.currentPrice!)}</span>
            {meanN != null && curN != null && (
              <span className="flex items-center gap-1">
                <Delta
                  value={meanN - curN}
                  percent={((meanN - curN) / curN) * 100}
                  currency={ratings.currentPrice!.currency}
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

function RatingsSkeleton() {
  return (
    <section className="mb-10" role="status" aria-label="Loading analyst ratings">
      <SectionHeader title="Analyst ratings" />
      <Card>
        <div className="space-y-2">
          <Skeleton className="h-2.5 w-full rounded-full" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="mt-8 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}
