import type { ReactNode } from "react";
import { Card, Delta, Stat } from "@sage/ui";
import {
  formatCompactMoney,
  formatDate,
  formatMoney,
  formatShares,
  moneyToNumber,
} from "../../../../lib/format";
import { netFactor } from "../../../../lib/dividend-tax";
import {
  analystUpside,
  cashDate,
  currentYield,
  nextPayment,
  nextTwelveMonths,
  rangePlace,
  RANGE_PLACE_PHRASE,
  REASONS,
  type Figure,
} from "../../../../lib/asset-page/figures";
import {
  basisWord,
  formatPct,
  formatPerShare,
  isFilled,
  prettySector,
} from "../../../../lib/asset-page/labels";
import { staleAsOf } from "../../../../lib/asset-page/reliability";
import type { AnalystRatingsDTO, AssetDetailDTO } from "../../../../lib/types";
import { Missing, StaleNote } from "./reliability-marks";
import { SignedPct } from "./signed-pct";

export interface AnswerStripProps {
  detail: AssetDetailDTO;
  taxRate: number | null;
  todayISO: string;
  weight: Figure<number>;
  ratings: AnalystRatingsDTO | null | undefined;
  /** The Add transaction control: "Your position" offers it when not held. */
  addAction: ReactNode;
}

function Tile({
  label,
  value,
  lines,
  title,
}: {
  label: string;
  value: ReactNode;
  lines: ReactNode[];
  title?: string;
}) {
  return (
    <Card compact className="min-w-0" title={title}>
      <Stat
        size="sm"
        label={label}
        value={
          <div data-tile-value="" className="min-w-0 break-words [overflow-wrap:anywhere]">
            {value}
          </div>
        }
        context={
          <div className="space-y-0.5 break-words [overflow-wrap:anywhere]">
            {lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        }
      />
    </Card>
  );
}

function PaysYouTile({
  detail,
  taxRate,
  todayISO,
}: Pick<AnswerStripProps, "detail" | "taxRate" | "todayISO">) {
  const f = netFactor(taxRate);
  const held = detail.position.held && detail.position.quantity != null;
  const qty = held ? Number(detail.position.quantity) : 1;
  const next12 = nextTwelveMonths(detail.upcoming, qty);
  if (!next12.ok) {
    const reason = detail.dividends.history.length === 0 ? REASONS.noDividends : next12.reason;
    return <Tile label="Pays you" value={<Missing reason={reason} />} lines={[reason]} />;
  }
  const net = Number(next12.value.amount) * f;
  const value = held
    ? formatMoney({ amount: net.toFixed(2), currency: next12.value.currency })
    : `${formatPerShare({ amount: net.toFixed(4), currency: next12.value.currency })} / share / yr`;

  const next = nextPayment(detail.upcoming, todayISO);
  const nextAmount = next
    ? held
      ? formatMoney({
          amount: (Number(next.amountPerShare) * qty * f).toFixed(2),
          currency: next.currency,
        })
      : `${formatPerShare({ amount: (Number(next.amountPerShare) * f).toFixed(4), currency: next.currency })} / share`
    : null;

  return (
    <Tile
      label="Pays you"
      value={<span className="text-income">{value}</span>}
      lines={[
        `next 12 months, ${basisWord(taxRate)}`,
        next
          ? `next payment: ${formatDate(cashDate(next), { year: "always" })} · ${nextAmount} · ${next.certainty}`
          : "no payment date yet",
      ]}
    />
  );
}

function PositionTile({
  detail,
  weight,
  addAction,
}: Pick<AnswerStripProps, "detail" | "weight" | "addAction">) {
  const p = detail.position;
  if (!p.held) return <Tile label="Your position" value="Not in your book" lines={[addAction]} />;
  const gain = p.unrealizedGainLoss ? (
    <Delta
      value={moneyToNumber(p.unrealizedGainLoss)}
      percent={p.gainLossPercent ?? undefined}
      currency={p.unrealizedGainLoss.currency}
      className="flex-wrap"
    />
  ) : (
    <Missing reason={REASONS.noQuote} />
  );
  const shares = p.quantity ? `${formatShares(p.quantity)} shares` : null;
  // A weight Sage can't give — the book still loading, or values in more than
  // one currency with no display currency set — is "—" with the reason on
  // hover, in the same place the percent would stand. Never a sum across
  // currencies, never a zero.
  const share = weight.ok ? (
    `${(weight.value * 100).toFixed(1)}% of your book`
  ) : (
    <>
      <Missing reason={weight.reason} /> of your book
    </>
  );
  return (
    <Tile
      label="Your position"
      value={gain}
      lines={[
        <>
          {shares && `${shares} · `}
          {share}
        </>,
      ]}
    />
  );
}

function BuyMoreTile({
  detail,
  taxRate,
  ratings,
  todayISO,
}: Pick<AnswerStripProps, "detail" | "taxRate" | "ratings" | "todayISO">) {
  const y = currentYield(detail);
  if (!y.ok)
    return <Tile label="Buy more?" value={<Missing reason={y.reason} />} lines={[y.reason]} />;
  const facts: string[] = [basisWord(taxRate)];
  const range = detail.yieldRange5y;
  if (range) facts.push(RANGE_PLACE_PHRASE[rangePlace(range.low, range.high, y.value)]);
  const upside = ratings ? analystUpside(ratings.targets.mean, detail.quote) : null;
  const ratingsStale = ratings ? staleAsOf(ratings.asOf, todayISO) : null;
  return (
    <Tile
      label="Buy more?"
      value={<span className="text-income">{formatPct(y.value * netFactor(taxRate))}</span>}
      title={
        ratings && upside?.ok
          ? `Analyst figures, as of ${formatDate(ratings.asOf.slice(0, 10), { year: "always" })}`
          : undefined
      }
      lines={[
        facts.join(" · "),
        ...(upside?.ok
          ? [
              <>
                analysts <SignedPct pct={upside.value.pct} /> to mean target
                <StaleNote note={ratingsStale} />
              </>,
            ]
          : []),
      ]}
    />
  );
}

function WhatItIsTile({ detail, todayISO }: Pick<AnswerStripProps, "detail" | "todayISO">) {
  const { profile, profileAsOf } = detail;
  const fund = profile.fund;
  const head = fund
    ? isFilled(fund.category)
      ? fund.category
      : null
    : profile.sector
      ? prettySector(profile.sector)
      : null;
  const facts = fund
    ? [
        profile.country,
        fund.totalAssets ? `AUM ${formatCompactMoney(fund.totalAssets, profile.currency)}` : null,
      ]
    : [
        profile.country,
        profile.fullTimeEmployees
          ? `${Number(profile.fullTimeEmployees).toLocaleString("en-US")} employees`
          : null,
      ];
  const line = facts.filter(isFilled).join(" · ");
  const reason = fund ? "The provider gives no category" : "The provider gives no sector";
  // Provider figures: dated on hover, and inline once more than 7 days old.
  const stale = staleAsOf(profileAsOf, todayISO);
  return (
    <Tile
      label="What it is"
      title={
        profileAsOf
          ? `Provider figures, as of ${formatDate(profileAsOf, { year: "always" })}`
          : undefined
      }
      value={head ?? <Missing reason={reason} />}
      lines={[
        line || (head ? "The provider gives no further detail" : reason),
        ...(stale ? [stale] : []),
      ]}
    />
  );
}

/**
 * The four reasons the maintainer opens a holding, answered before anything
 * else: what it pays, how the position is doing, whether it is cheap against
 * itself, what it is. Four slots always — a tile Sage cannot fill keeps its
 * label and says why.
 */
export function AnswerStrip(props: AnswerStripProps) {
  return (
    <section aria-label="At a glance" className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <PaysYouTile detail={props.detail} taxRate={props.taxRate} todayISO={props.todayISO} />
      <PositionTile detail={props.detail} weight={props.weight} addAction={props.addAction} />
      <BuyMoreTile
        detail={props.detail}
        taxRate={props.taxRate}
        ratings={props.ratings}
        todayISO={props.todayISO}
      />
      <WhatItIsTile detail={props.detail} todayISO={props.todayISO} />
    </section>
  );
}
