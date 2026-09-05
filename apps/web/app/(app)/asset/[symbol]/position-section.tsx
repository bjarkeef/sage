"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Delta, SectionHeader, Stat } from "@sage/ui";
import { getPortfolio } from "../../../../lib/api";
import { qk } from "../../../../lib/query/keys";
import { formatMoney, moneyToNumber } from "../../../../lib/format";
import { netFactor } from "../../../../lib/dividend-tax";
import type { AssetPositionDTO } from "../../../../lib/types";

export function PositionSection({
  position,
  currency,
  symbol,
  taxRate,
}: {
  position: AssetPositionDTO;
  currency: string;
  symbol: string;
  taxRate: number | null;
}) {
  const { data: portfolio } = useQuery({
    queryKey: qk.portfolio(),
    queryFn: () => getPortfolio(),
    staleTime: 300_000,
    enabled: position.held,
  });

  if (!position.held) return null;

  // Income figures net, the same way the Income section below nets its yields —
  // this section previously took no tax rate at all, so the page showed the
  // same "Yield on cost" twice, gross here and net there, ~200px apart. The
  // basis now rides on each figure rather than on a caption in another card.
  const f = netFactor(taxRate);
  const basis = taxRate != null ? "after tax" : "before tax";
  const yieldOnCost = position.yieldOnCost == null ? null : position.yieldOnCost * f;
  const forwardIncome = position.forwardAnnualIncome
    ? {
        amount: (Number(position.forwardAnnualIncome.amount) * f).toFixed(2),
        currency: position.forwardAnnualIncome.currency,
      }
    : null;
  const dividendIncome = position.totalDividendIncome
    ? (Number(position.totalDividendIncome) * f).toFixed(2)
    : null;

  let weight: number | null = null;
  if (portfolio) {
    const total = portfolio.positions.reduce(
      (s, p) => s + (p.marketValue ? moneyToNumber(p.marketValue) : 0),
      0,
    );
    const mine = portfolio.positions.find((p) => p.symbol === symbol)?.marketValue;
    if (total > 0 && mine) weight = moneyToNumber(mine) / total;
  }

  // Tiled bento strip (5×2): each cell a labeled figure, hairline gridlines
  // between. Order mirrors the approved mockup — identity/valuation first,
  // then the income/new figures on the second row.
  const cells: { label: string; value: React.ReactNode; context?: string }[] = [
    { label: "Shares", value: position.quantity ?? "—" },
    { label: "Avg cost", value: position.averageCost ? formatMoney(position.averageCost) : "—" },
    { label: "Cost basis", value: position.costBasis ? formatMoney(position.costBasis) : "—" },
    {
      label: "Market value",
      value: position.marketValue ? formatMoney(position.marketValue) : "—",
    },
    {
      label: "Gain / loss",
      value: position.unrealizedGainLoss ? (
        <Delta
          className="text-base"
          value={moneyToNumber(position.unrealizedGainLoss)}
          percent={position.gainLossPercent ?? undefined}
          currency={currency}
        />
      ) : (
        "—"
      ),
    },
    {
      label: "Yield on cost",
      value:
        yieldOnCost != null ? (
          <span className="text-income">{`${(yieldOnCost * 100).toFixed(2)}%`}</span>
        ) : (
          "—"
        ),
      context: yieldOnCost != null ? basis : undefined,
    },
    {
      label: "Forward income",
      value: forwardIncome ? formatMoney(forwardIncome) : "—",
      context: forwardIncome ? `next 12 mo, ${basis}` : undefined,
    },
    { label: "Weight", value: weight != null ? `${(weight * 100).toFixed(1)}%` : "—" },
    { label: "Fees paid", value: position.feesPaid ? formatMoney(position.feesPaid) : "—" },
    {
      label: "Dividend income",
      value: dividendIncome ? formatMoney({ amount: dividendIncome, currency }) : "—",
      context: dividendIncome ? basis : undefined,
    },
  ];

  return (
    <section className="mb-10">
      <SectionHeader title="Your position" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline-faint bg-hairline-faint sm:grid-cols-5">
        {cells.map((c) => (
          <div key={c.label} className="bg-background p-4">
            <Stat size="sm" label={c.label} value={c.value} context={c.context} />
          </div>
        ))}
      </div>
    </section>
  );
}
