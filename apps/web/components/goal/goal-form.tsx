"use client";

import * as React from "react";
import { Card, Field, SegmentedControl, Input, Switch, Button } from "@sage/ui";
import type { GoalDTO, GoalDefaultsDTO, PutGoalInput } from "../../lib/types";

const MODES = [
  { label: "Passive income", value: "passive_income" },
  { label: "Value", value: "value" },
];
const INCREASE_OPTIONS = [
  { label: "No", value: "none" },
  { label: "Adjust for inflation", value: "inflation" },
  { label: "Custom %", value: "custom" },
] as const;

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() === "" || Number.isNaN(n) ? null : n;
}

/** Collapsible section header — plain button + chevron, no ui dependency. */
function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-sm font-medium"
      >
        {title}
        <span className="text-xs text-muted-foreground">{open ? "− Collapse" : "+ Expand"}</span>
      </button>
      {open && <div className="mt-3 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

export function GoalForm({
  goal,
  defaults,
  saving,
  onSave,
  onDelete,
}: {
  goal: GoalDTO | null;
  defaults: GoalDefaultsDTO;
  saving: boolean;
  onSave: (input: PutGoalInput) => void;
  onDelete: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const [mode, setMode] = React.useState<"passive_income" | "value">(
    goal?.type ?? "passive_income",
  );
  const [amount, setAmount] = React.useState(goal?.amount ?? "");
  const [targetYear, setTargetYear] = React.useState(goal?.targetYear ?? currentYear + 10);
  const [contribution, setContribution] = React.useState(goal?.monthlyContribution ?? "");
  const [increase, setIncrease] = React.useState<"none" | "inflation" | "custom">(
    goal?.contributionIncrease ?? "inflation",
  );
  const [increasePct, setIncreasePct] = React.useState(goal?.contributionIncreasePct ?? "");
  const [divYield, setDivYield] = React.useState(goal?.divYieldPct ?? "");
  const [divGrowth, setDivGrowth] = React.useState(goal?.divGrowthPct ?? "");
  const [annualReturn, setAnnualReturn] = React.useState(goal?.annualReturnPct ?? "");
  const [adjustInflation, setAdjustInflation] = React.useState(
    goal?.adjustGoalForInflation ?? true,
  );
  const [inflation, setInflation] = React.useState(goal?.inflationPct ?? defaults.inflationPct);
  const [reinvest, setReinvest] = React.useState(goal?.reinvestDividends ?? true);
  const [suggestAlt, setSuggestAlt] = React.useState(goal?.suggestAlternative ?? true);
  const [returnsOpen, setReturnsOpen] = React.useState(false);
  const [otherOpen, setOtherOpen] = React.useState(false);

  const amountNum = num(amount);
  const monthlyEcho = amountNum != null && mode === "passive_income" ? amountNum / 12 : null;
  // With a dividend tax rate set, income goals are simulated net of tax — the
  // amount the user types here is what they want to receive AFTER tax.
  const netIncome = mode === "passive_income" && defaults.dividendTaxRate != null;

  const submit = () => {
    if (amountNum == null || amountNum <= 0) return;
    onSave({
      type: mode,
      amount: amountNum,
      targetYear,
      monthlyContribution: num(contribution),
      contributionIncrease: increase,
      contributionIncreasePct: increase === "custom" ? num(increasePct) : null,
      divYieldPct: num(divYield),
      divGrowthPct: num(divGrowth),
      annualReturnPct: num(annualReturn),
      adjustGoalForInflation: adjustInflation,
      inflationPct: num(inflation) ?? Number(defaults.inflationPct),
      reinvestDividends: reinvest,
      suggestAlternative: suggestAlt,
    });
  };

  return (
    <Card compact className="flex flex-col gap-4">
      <Field label="Goal" id="goal-mode">
        <SegmentedControl
          options={MODES}
          value={mode}
          onChange={(v) => setMode(v as typeof mode)}
          size="sm"
          aria-labelledby="goal-mode-label"
        />
      </Field>

      <Field
        label="Goal amount"
        htmlFor="goal-amount"
        hint={
          monthlyEcho != null
            ? `${amountNum!.toLocaleString()} ${defaults.currency} annually, ${Math.round(monthlyEcho).toLocaleString()} ${defaults.currency} monthly${netIncome ? " after tax" : ""}`
            : mode === "value"
              ? `Target portfolio value in ${defaults.currency}`
              : netIncome
                ? `Annual passive income in ${defaults.currency}, after tax (${defaults.dividendTaxRate}% dividend tax applied)`
                : `Annual passive income in ${defaults.currency}`
        }
      >
        <div className="flex items-center gap-2">
          <Input
            id="goal-amount"
            inputMode="decimal"
            placeholder="E.g. 120000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <span className="font-mono text-xs text-muted-foreground">{defaults.currency}</span>
        </div>
      </Field>

      <Field label="Achieve by" htmlFor="goal-year">
        <div className="relative">
          <select
            id="goal-year"
            value={targetYear}
            onChange={(e) => setTargetYear(Number(e.target.value))}
            className="h-9 w-full appearance-none rounded-control border border-border bg-transparent px-3 pr-8 text-sm"
          >
            {Array.from({ length: 50 }, (_, i) => currentYear + 1 + i).map((y) => (
              <option key={y} value={y}>
                {y} (in {y - currentYear} {y - currentYear === 1 ? "year" : "years"})
              </option>
            ))}
          </select>
          <svg
            aria-hidden
            className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </Field>

      <Field
        label="Contributions"
        htmlFor="goal-contribution"
        hint={
          Number(defaults.monthlyContribution) <= 0 ? (
            "Per month."
          ) : (
            <>
              Per month. If empty, uses your 12-month average (
              <button
                type="button"
                className="underline decoration-dotted underline-offset-2"
                onClick={() => setContribution(defaults.monthlyContribution)}
              >
                {Number(defaults.monthlyContribution).toLocaleString()} {defaults.currency}
              </button>
              ).
            </>
          )
        }
      >
        <Input
          id="goal-contribution"
          inputMode="decimal"
          placeholder={defaults.monthlyContribution}
          value={contribution}
          onChange={(e) => setContribution(e.target.value)}
        />
      </Field>

      <Section
        title="Returns & inflation"
        open={returnsOpen}
        onToggle={() => setReturnsOpen(!returnsOpen)}
      >
        {mode === "passive_income" ? (
          <>
            <Field
              label="Div. yield %"
              htmlFor="goal-yield"
              hint={
                defaults.divYieldPct
                  ? `If empty, uses calculated ${defaults.divYieldPct}%`
                  : undefined
              }
            >
              <Input
                id="goal-yield"
                inputMode="decimal"
                placeholder={defaults.divYieldPct ?? ""}
                value={divYield}
                onChange={(e) => setDivYield(e.target.value)}
              />
            </Field>
            <Field
              label="Dividend growth %"
              htmlFor="goal-growth"
              hint={
                defaults.divGrowthPct
                  ? `If empty, uses calculated ${defaults.divGrowthPct}% (5-yr CAGR)`
                  : undefined
              }
            >
              <Input
                id="goal-growth"
                inputMode="decimal"
                placeholder={defaults.divGrowthPct ?? ""}
                value={divGrowth}
                onChange={(e) => setDivGrowth(e.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field
            label="Returns %"
            htmlFor="goal-returns"
            hint={
              defaults.annualReturnPct
                ? `If empty, uses calculated ${defaults.annualReturnPct}% (all-time MWR)`
                : "Planning above-market returns is risky"
            }
          >
            <Input
              id="goal-returns"
              inputMode="decimal"
              placeholder={defaults.annualReturnPct ?? ""}
              value={annualReturn}
              onChange={(e) => setAnnualReturn(e.target.value)}
            />
          </Field>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm">Reinvest dividends?</span>
          <Switch checked={reinvest} onCheckedChange={setReinvest} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">Adjust goal for inflation?</span>
          <Switch checked={adjustInflation} onCheckedChange={setAdjustInflation} />
        </div>
        <Field label="Increase contributions?" htmlFor="goal-increase">
          <div className="flex items-center gap-2">
            <select
              id="goal-increase"
              value={increase}
              onChange={(e) => setIncrease(e.target.value as typeof increase)}
              className="h-9 flex-1 rounded-control border border-border bg-transparent px-3 text-sm"
            >
              {INCREASE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {increase === "custom" && (
              <Input
                aria-label="Custom increase %"
                inputMode="decimal"
                className="w-20"
                value={increasePct}
                onChange={(e) => setIncreasePct(e.target.value)}
              />
            )}
          </div>
        </Field>
        <Field label="Inflation %" htmlFor="goal-inflation">
          <Input
            id="goal-inflation"
            inputMode="decimal"
            value={inflation}
            onChange={(e) => setInflation(e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Other" open={otherOpen} onToggle={() => setOtherOpen(!otherOpen)}>
        <div className="flex items-center justify-between">
          <span className="text-sm">Suggest alternative scenario</span>
          <Switch checked={suggestAlt} onCheckedChange={setSuggestAlt} />
        </div>
      </Section>

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <Button onClick={submit} disabled={saving || amountNum == null || amountNum <= 0}>
          {saving ? "Calculating…" : "Save and calculate"}
        </Button>
        {goal && (
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            Remove goal
          </button>
        )}
      </div>
    </Card>
  );
}
