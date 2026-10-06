"use client";

import * as React from "react";
import { Card, SectionHeader } from "@sage/ui";
import { formatCompactMoney, formatDate, formatMoney } from "../../../../lib/format";
import { netFactor } from "../../../../lib/dividend-tax";
import {
  analystUpside,
  currentYield,
  isFiveYearSpan,
  yieldRangeBasis,
} from "../../../../lib/asset-page/figures";
import { basisWord, formatPct } from "../../../../lib/asset-page/labels";
import {
  checkCurrentYield,
  payoutRatioFlag,
  peFlag,
  staleAsOf,
  yieldRangeFlag,
} from "../../../../lib/asset-page/reliability";
import type { AnalystRatingsDTO, AssetDetailDTO } from "../../../../lib/types";
import { AnalystDetail, CONSENSUS } from "./analyst-ratings-section";
import { FactRow, type Fact } from "./fact-row";
import { RangeBar } from "./range-bar";
import { SignedPct } from "./signed-pct";

function yieldRangeLabel(from: string, todayISO: string): string {
  return isFiveYearSpan(from, todayISO)
    ? "Yield vs its own 5 years"
    : `Yield vs ${yieldRangeBasis(from, todayISO)}`;
}

/**
 * § 6, "Buy more?": facts, no verdict and no score — where today's yield and
 * price sit against the holding's own history, and what the provider and the
 * analysts say. How to JUDGE a purchase is a later exploration (spec, out of
 * scope). The provider's gross dividend yield is deliberately absent.
 */
export function BuyMoreSection({
  detail,
  taxRate,
  ratings,
  todayISO,
}: {
  detail: AssetDetailDTO;
  taxRate: number | null;
  ratings: AnalystRatingsDTO | null | undefined;
  todayISO: string;
}) {
  const [showAnalysts, setShowAnalysts] = React.useState(false);
  const { profile, quote, income, yieldRange5y, profileAsOf } = detail;
  const fund = profile.fund;
  const f = netFactor(taxRate);
  const y = currentYield(detail);
  const yieldNow = y.ok ? y.value : null;

  const facts: Fact[] = [];
  if (!fund && income.payoutRatio != null) {
    facts.push({
      label: "Payout ratio",
      value: formatPct(income.payoutRatio, 0),
      flag: payoutRatioFlag(income.payoutRatio),
      asOf: profileAsOf,
    });
  }
  if (!fund && profile.peRatio != null) {
    const pe = Number(profile.peRatio);
    facts.push({ label: "P/E", value: pe.toFixed(1), flag: peFlag(pe), asOf: profileAsOf });
  }
  if (fund?.expenseRatio != null) {
    facts.push({
      label: "Expense ratio",
      value: formatPct(Number(fund.expenseRatio)),
      asOf: profileAsOf,
    });
  }
  if (ratings && ratings.analystCount > 0) {
    const upside = analystUpside(ratings.targets.mean, quote);
    const summary = [
      ratings.consensusKey ? CONSENSUS[ratings.consensusKey].label : null,
      `${ratings.analystCount} analysts`,
      ratings.targets.mean ? `mean ${formatMoney(ratings.targets.mean)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    facts.push({
      label: "Analysts",
      text: true,
      asOf: ratings.asOf,
      value: (
        <>
          {summary}
          {upside.ok && (
            <>
              {" ("}
              <SignedPct pct={upside.value.pct} />
              {")"}
            </>
          )}
        </>
      ),
    });
  }
  if (profile.marketCap != null) {
    facts.push({
      label: "Market cap",
      value: formatCompactMoney(profile.marketCap, profile.currency),
      asOf: profileAsOf,
    });
  }
  if (profile.beta != null) {
    facts.push({ label: "Beta", value: Number(profile.beta).toFixed(2), asOf: profileAsOf });
  }

  const low52 = profile.fiftyTwoWeekLow;
  const high52 = profile.fiftyTwoWeekHigh;
  const has52 =
    low52 != null &&
    high52 != null &&
    quote != null &&
    low52.currency === quote.price.currency &&
    high52.currency === quote.price.currency &&
    Number(high52.amount) > Number(low52.amount);
  const hasYieldRange = yieldRange5y != null && yieldNow != null;
  const hasAnalysts = ratings != null && ratings.analystCount > 0;
  // Custom holdings have no provider facts; the page does not render this for
  // them, and a stray one must not run the yield check against a made-up price.
  if (detail.custom != null) return null;
  if (!hasYieldRange && !has52 && facts.length === 0) return null;

  const providerTitle = profileAsOf
    ? `Provider figure, as of ${formatDate(profileAsOf, { year: "always" })}`
    : "Provider figure";

  return (
    <section className="mb-10">
      <SectionHeader title="Buy more?" meta="facts, not a verdict" />
      <Card className="grid gap-x-12 gap-y-8 md:grid-cols-2">
        {(hasYieldRange || has52) && (
          <div className="min-w-0 space-y-8">
            {hasYieldRange && (
              <RangeBar
                label={yieldRangeLabel(yieldRange5y.from, todayISO)}
                context={basisWord(taxRate)}
                low={yieldRange5y.low * f}
                high={yieldRange5y.high * f}
                current={yieldNow * f}
                format={(v) => formatPct(v)}
                flag={
                  // Consistency check (spec: Data reliability 3): today's yield
                  // must be the trailing dividend ÷ the header price.
                  checkCurrentYield(income.currentYield, income.annualDividend, quote)
                    ? yieldRangeFlag(yieldRange5y)
                    : {
                        reason:
                          "Today's yield does not equal the trailing dividend ÷ today's price; one of them is wrong.",
                      }
                }
              />
            )}
            {has52 && (
              <RangeBar
                label="52-week range"
                title={providerTitle}
                context={staleAsOf(profileAsOf, todayISO) ?? undefined}
                low={Number(low52.amount)}
                high={Number(high52.amount)}
                current={Number(quote.price.amount)}
                format={(v) => formatMoney({ amount: String(v), currency: quote.price.currency })}
              />
            )}
          </div>
        )}
        {facts.length > 0 && (
          <dl className="min-w-0">
            {facts.map((fact) => (
              <FactRow key={fact.label} fact={fact} todayISO={todayISO} />
            ))}
          </dl>
        )}
        {hasAnalysts && (
          <div className="md:col-span-2">
            <button
              type="button"
              aria-expanded={showAnalysts}
              onClick={() => setShowAnalysts((v) => !v)}
              className="rounded-control text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showAnalysts ? "Hide analyst detail" : "Analyst detail"}
            </button>
            {showAnalysts && (
              <div className="mt-4">
                <AnalystDetail ratings={ratings} quote={quote} />
              </div>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
