import { Card, Delta, SectionHeader, Stat } from "@sage/ui";
import { formatMoney, formatShares, moneyToNumber } from "../../../../lib/format";
import { REASONS, type Figure } from "../../../../lib/asset-page/figures";
import type { AssetPositionDTO } from "../../../../lib/types";
import { Missing } from "./reliability-marks";

/**
 * What you hold and what it is worth, in one row. Yield on cost, the next 12
 * months and dividends received moved to "What it pays you": each figure on
 * the page once.
 */
export function PositionSection({
  position,
  weight,
}: {
  position: AssetPositionDTO;
  weight: Figure<number>;
}) {
  if (!position.held) return null;
  const cells = [
    {
      label: "Shares",
      value: position.quantity ? (
        formatShares(position.quantity)
      ) : (
        <Missing reason="No shares recorded" />
      ),
    },
    {
      label: "Average cost",
      value: position.averageCost ? (
        formatMoney(position.averageCost)
      ) : (
        <Missing reason="No cost recorded" />
      ),
    },
    {
      label: "Value",
      value: position.marketValue ? (
        formatMoney(position.marketValue)
      ) : (
        <Missing reason={REASONS.noQuote} />
      ),
    },
    {
      label: "Gain",
      value: position.unrealizedGainLoss ? (
        <Delta
          value={moneyToNumber(position.unrealizedGainLoss)}
          percent={position.gainLossPercent ?? undefined}
          currency={position.unrealizedGainLoss.currency}
        />
      ) : (
        <Missing reason={REASONS.noQuote} />
      ),
    },
    {
      label: "Weight",
      value: weight.ok ? `${(weight.value * 100).toFixed(1)}%` : <Missing reason={weight.reason} />,
    },
    {
      label: "Fees paid",
      value: position.feesPaid ? (
        formatMoney(position.feesPaid)
      ) : (
        <Missing reason="No fees recorded" />
      ),
    },
  ];
  return (
    <section className="mb-10">
      <SectionHeader title="Your position" />
      <Card className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0 break-words [overflow-wrap:anywhere]">
            <Stat size="sm" label={c.label} value={c.value} />
          </div>
        ))}
      </Card>
    </section>
  );
}
