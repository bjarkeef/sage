"use client";

import type { GoalResultDTO } from "../../lib/types";
import { formatMoneyWhole } from "../../lib/format";
import { InfoTooltip } from "@sage/ui";

/** SVG progress ring + headline numbers + achievability line. */
export function GoalProgressHero({
  result,
  mode,
}: {
  result: GoalResultDTO;
  mode: "passive_income" | "value";
}) {
  const pct = Math.max(0, Math.min(100, result.progressPct));
  const R = 30;
  const C = 2 * Math.PI * R;
  const currentYear = new Date().getFullYear();
  const metricLabel = mode === "value" ? "Portfolio value" : "Passive income";

  const achievability =
    result.achievedInYears == null
      ? { text: "Not reachable within 50 years with these parameters", tone: "text-loss" }
      : result.achievedYear! > result.targetYear
        ? {
            text: `Achievable in ${result.achievedInYears} years · by ${result.achievedYear}`,
            tone: "text-foreground",
          }
        : {
            text: `On track — achievable in ${result.achievedInYears} years · by ${result.achievedYear}`,
            tone: "text-gain",
          };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="relative h-[72px] w-[72px]">
          <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
            <circle cx="36" cy="36" r={R} fill="none" stroke="var(--hairline)" strokeWidth="6" />
            <circle
              cx="36"
              cy="36"
              r={R}
              fill="none"
              stroke="var(--income)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * C} ${C}`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center font-mono text-sm tabular-nums">
            {Math.round(result.progressPct)}%
          </div>
        </div>
        <div>
          <div className="font-mono text-2xl font-light leading-none tabular-nums">
            {formatMoneyWhole({ amount: result.currentMetric, currency: result.currency })}
            <span className="text-muted-foreground">
              {" / "}
              {formatMoneyWhole({ amount: result.goalAtTargetYear, currency: result.currency })}
            </span>
            {mode === "passive_income" && (
              <span className="ml-1 font-sans text-xs text-muted-foreground">annually</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1 label-caps text-muted-foreground">
            {metricLabel}
            {mode === "passive_income" && (
              <InfoTooltip label="About this figure">
                {result.netMode
                  ? "Projected passive income after your configured dividend tax rate — a single flat rate, not per-country withholding."
                  : "Projected passive income before dividend tax. Set a rate in Settings for a net projection."}
              </InfoTooltip>
            )}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={`text-sm font-medium ${achievability.tone}`}>{achievability.text}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {result.targetYear <= currentYear
            ? `Target: ${result.targetYear} (passed)`
            : `Target: ${result.targetYear} (in ${result.targetYear - currentYear} years)`}
        </div>
      </div>
    </div>
  );
}
