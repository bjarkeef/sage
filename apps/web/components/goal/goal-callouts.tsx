"use client";

import type { GoalResultDTO, GoalScenarioDTO } from "../../lib/types";
import { formatMoney } from "../../lib/format";

const KNOB_LABELS: Record<string, string> = {
  contributionGrowthPct: "Contribution increase",
  divGrowthPct: "Dividend growth",
  monthlyContribution: "Monthly contribution",
};

function ParamChips({ s, currency }: { s: GoalScenarioDTO; currency: string }) {
  const changedKeys = new Set((s.changed ?? []).map((c) => c.key));
  const chip = (label: string, value: string, changed: boolean) => (
    <span
      key={label}
      // A changed assumption is emphasised by weight, not by the accent: these
      // are chrome, and the accent has an allowlist (DESIGN.md §1). The filled
      // wash also reads as "this one moved" faster than a tinted outline did.
      className={`inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs ${
        changed
          ? "bg-foreground/10 font-medium text-foreground"
          : "border border-hairline text-muted-foreground"
      }`}
    >
      {label}: <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chip("Div. yield", `${s.params.divYieldPct}%`, false)}
      {chip("Dividend growth", `${s.params.divGrowthPct}%`, changedKeys.has("divGrowthPct"))}
      {chip(
        "Contributions",
        `${formatMoney({ amount: s.params.monthlyContribution, currency })} (+${s.params.contributionGrowthPct}%/yr)`,
        changedKeys.has("monthlyContribution") || changedKeys.has("contributionGrowthPct"),
      )}
      {chip("Reinvest", s.params.reinvestDividends ? "yes" : "no", false)}
    </div>
  );
}

export function GoalCallouts({ result }: { result: GoalResultDTO }) {
  const portfolio = result.scenarios.find((s) => s.id === "portfolio")!;
  const alternative = result.scenarios.find((s) => s.id === "alternative");
  const late =
    result.achievedYear != null && result.achievedYear > result.targetYear
      ? result.achievedYear - result.targetYear
      : null;

  return (
    <div className="flex flex-col gap-3">
      {result.achievedInYears == null ? (
        <div className="rounded-card bg-loss/10 p-4 text-sm">
          <span className="label-caps text-loss">Risk</span>
          <p className="mt-1">
            This goal isn&apos;t reachable within 50 years with the current parameters.
          </p>
          <ParamChips s={portfolio} currency={result.currency} />
        </div>
      ) : late != null ? (
        <div className="rounded-card bg-loss/10 p-4 text-sm">
          <span className="label-caps text-loss">Risk</span>
          <p className="mt-1">
            Your goal can be achieved in {result.achievedInYears} years (by {result.achievedYear}
            ). It&apos;s {late} {late === 1 ? "year" : "years"} later than your target.
          </p>
          <ParamChips s={portfolio} currency={result.currency} />
        </div>
      ) : (
        <div className="rounded-card bg-gain/10 p-4 text-sm">
          <span className="label-caps text-gain">On track</span>
          <p className="mt-1">
            Your goal is achievable in {result.achievedInYears} years (by {result.achievedYear}) —
            within your target of {result.targetYear}.
          </p>
          <ParamChips s={portfolio} currency={result.currency} />
        </div>
      )}

      {alternative && (
        <div className="rounded-card bg-surface-card p-4 text-sm">
          <span className="label-caps">Insight</span>
          <p className="mt-1">
            Your goal can be achieved{" "}
            {alternative.achievedInYears != null
              ? `in ${alternative.achievedInYears} years (by ${alternative.achievedYear})`
              : "sooner"}{" "}
            with an alternative scenario:{" "}
            {(alternative.changed ?? [])
              .map((c) => {
                const label = KNOB_LABELS[c.key] ?? c.key;
                const fmt = (v: string) =>
                  c.key === "monthlyContribution"
                    ? formatMoney({ amount: v, currency: result.currency })
                    : `${v}%`;
                return `${label} ${fmt(c.from)} → ${fmt(c.to)}`;
              })
              .join(", ")}
            .
          </p>
          <ParamChips s={alternative} currency={result.currency} />
        </div>
      )}
    </div>
  );
}
