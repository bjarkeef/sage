import { Card, SectionHeader } from "@sage/ui";
import type { AssetDetailDTO } from "../../../../lib/types";
import { formatCompactMoney, formatLargeNumber, formatMoney } from "../../../../lib/format";

/** "consumer_cyclical" → "Consumer Cyclical". */
export function prettySector(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FundamentalsSection({ profile }: { profile: AssetDetailDTO["profile"] }) {
  const metrics = profile.fund
    ? [
        {
          label: "Expense ratio",
          value: profile.fund.expenseRatio
            ? `${(Number(profile.fund.expenseRatio) * 100).toFixed(2)}%`
            : null,
        },
        {
          label: "AUM",
          value: profile.fund.totalAssets
            ? formatCompactMoney(profile.fund.totalAssets, profile.currency)
            : null,
        },
        {
          label: "Dividend Yield",
          value: profile.dividendYield
            ? `${(Number(profile.dividendYield) * 100).toFixed(2)}%`
            : null,
        },
        {
          label: "Category",
          value: profile.fund.category,
        },
        { label: "Fund family", value: profile.fund.family },
        { label: "Legal type", value: profile.fund.legalType },
        {
          label: "52W High",
          value: profile.fiftyTwoWeekHigh ? formatMoney(profile.fiftyTwoWeekHigh) : null,
        },
        {
          label: "52W Low",
          value: profile.fiftyTwoWeekLow ? formatMoney(profile.fiftyTwoWeekLow) : null,
        },
      ]
    : [
        {
          label: "Market Cap",
          value: profile.marketCap ? formatLargeNumber(profile.marketCap) : null,
        },
        {
          label: "P/E Ratio",
          value: profile.peRatio ? Number(profile.peRatio).toFixed(2) : null,
        },
        { label: "Beta", value: profile.beta ? Number(profile.beta).toFixed(2) : null },
        {
          label: "52W High",
          value: profile.fiftyTwoWeekHigh ? formatMoney(profile.fiftyTwoWeekHigh) : null,
        },
        {
          label: "52W Low",
          value: profile.fiftyTwoWeekLow ? formatMoney(profile.fiftyTwoWeekLow) : null,
        },
        {
          label: "Dividend Yield",
          value: profile.dividendYield
            ? `${(Number(profile.dividendYield) * 100).toFixed(2)}%`
            : null,
        },
        {
          label: "Annual Dividend",
          value: profile.trailingAnnualDividend
            ? formatMoney(profile.trailingAnnualDividend)
            : null,
        },
        { label: "Sector", value: profile.sector ? prettySector(profile.sector) : null },
      ];

  return (
    <section className="mb-10">
      <SectionHeader title={profile.fund ? "Fund profile" : "Fundamentals"} />
      <Card>
        <div className="grid grid-cols-1 gap-x-12 sm:grid-cols-2">
          {metrics.map(({ label, value }) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 border-b border-hairline-faint py-2.5 last:border-0 sm:nth-last-2:border-0"
            >
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="text-right font-mono text-data tabular-nums">{value ?? "—"}</span>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}
