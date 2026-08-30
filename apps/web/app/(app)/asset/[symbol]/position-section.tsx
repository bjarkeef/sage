"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Delta, SectionHeader, Stat } from "@sage/ui";
import { getPortfolio } from "../../../../lib/api";
import { qk } from "../../../../lib/query/keys";
import { formatMoney, moneyToNumber } from "../../../../lib/format";
import type { AssetPositionDTO } from "../../../../lib/types";

export function PositionSection({
  position,
  currency,
  symbol,
}: {
  position: AssetPositionDTO;
  currency: string;
  symbol: string;
}) {
  const { data: portfolio } = useQuery({
    queryKey: qk.portfolio(),
    queryFn: () => getPortfolio(),
    staleTime: 300_000,
    enabled: position.held,
  });

  if (!position.held) return null;

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
        position.yieldOnCost != null ? (
          <span className="text-income">{`${(position.yieldOnCost * 100).toFixed(2)}%`}</span>
        ) : (
          "—"
        ),
    },
    {
      label: "Forward income",
      value: position.forwardAnnualIncome ? formatMoney(position.forwardAnnualIncome) : "—",
      context: position.forwardAnnualIncome ? "next 12 mo" : undefined,
    },
    { label: "Weight", value: weight != null ? `${(weight * 100).toFixed(1)}%` : "—" },
    { label: "Fees paid", value: position.feesPaid ? formatMoney(position.feesPaid) : "—" },
    {
      label: "Dividend income",
      value: position.totalDividendIncome
        ? formatMoney({ amount: position.totalDividendIncome, currency })
        : "—",
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
