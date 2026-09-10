"use client";

import Link from "next/link";
import { Card, InfoTooltip } from "@sage/ui";
import type { MoneyDTO } from "../../lib/types";
import { formatDate, formatMoney, formatMoneyWhole } from "../../lib/format";

function pct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(2)}%`;
}

export function AnnualIncomeCard({
  amount,
  yoyPct,
  payers,
}: {
  amount: MoneyDTO | null;
  /** Forward projection vs the trailing-12m received figure. */
  yoyPct: number | null;
  payers: number;
}) {
  return (
    <Card
      compact
      data-testid="kpi-card-income"
      className="relative flex h-full min-h-[138px] flex-col"
    >
      <div className="flex items-center gap-2 label-caps text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-income" />
        <span>Annual income</span>
        <InfoTooltip label="About this figure">
          Forward 12-month dividend income across your holdings, after dividend tax when a rate is
          set in Settings. The rate is a single flat rate, not per-country withholding.
        </InfoTooltip>
      </div>
      <div data-testid="annual-income" className="stat-num mt-3">
        {amount ? formatMoneyWhole(amount) : "—"}
      </div>
      <div className="mt-auto pt-2 text-xs text-muted-foreground">
        {yoyPct != null && (
          <span className={`tabular-nums ${yoyPct >= 0 ? "text-gain" : "text-loss"}`}>
            {yoyPct >= 0 ? "+" : "−"}
            {Math.abs(yoyPct).toFixed(1)}%
          </span>
        )}{" "}
        vs last 12m, {payers} payers
      </div>
    </Card>
  );
}

export function YieldCard({
  gross,
  taxRate,
  onCost,
}: {
  /** Gross (pre-tax) forward portfolio yield, currency-safe — see
   *  `computeGrossForwardYield`. Null when not computable single-currency. */
  gross: number | null;
  /** The user's configured dividend tax rate (0-100), null when unset. */
  taxRate: number | null;
  onCost: number | null;
}) {
  const net = gross != null && taxRate != null ? gross * (1 - taxRate / 100) : null;
  const hasTaxRate = taxRate != null;
  const headline = hasTaxRate ? net : gross;

  return (
    <Card
      compact
      data-testid="kpi-card-yield"
      className="relative flex h-full min-h-[138px] flex-col"
    >
      <div className="flex items-center gap-1 label-caps text-muted-foreground">
        <span>Yield</span>
        <InfoTooltip label="About this figure">
          Headline is forward yield: next-12-month income ÷ market value. Gross is before tax; net
          multiplies by (1 − tax rate) from Settings. &quot;On cost&quot; is a different metric —
          trailing twelve-month dividends ÷ cost basis (or the contractual rate for custom holdings)
          — so it can diverge from the forward headline.
        </InfoTooltip>
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <b data-testid="yield-net" className="stat-num">
          {pct(headline)}
        </b>
        <span className="text-xs text-muted-foreground">{hasTaxRate ? "net" : "yield"}</span>
      </div>
      <div className="mt-auto flex border-t border-hairline-faint pt-3">
        {hasTaxRate && (
          <div className="flex-1">
            <div className="label-caps text-muted-foreground">Before tax</div>
            <div className="mt-1 font-mono text-base tabular-nums">{pct(gross)}</div>
          </div>
        )}
        <div className={hasTaxRate ? "flex-1 border-l border-hairline-faint pl-3.5" : "flex-1"}>
          <div className="label-caps text-muted-foreground">On cost</div>
          <div className="mt-1 font-mono text-base tabular-nums">{pct(onCost)}</div>
        </div>
      </div>
      {!hasTaxRate && (
        <Link
          href="/settings"
          className="mt-2 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          Set a tax rate for a net figure
        </Link>
      )}
    </Card>
  );
}

export interface UpcomingPayment {
  symbol: string;
  date: string;
  amount: MoneyDTO;
}

export function CashFlowCard({
  monthly,
  upcoming,
}: {
  monthly: MoneyDTO | null;
  upcoming: UpcomingPayment[];
}) {
  const rows = upcoming.slice(0, 3);
  return (
    <Card
      compact
      data-testid="kpi-card-cashflow"
      className="relative flex h-full min-h-[138px] flex-col"
    >
      <div className="flex items-center gap-1 label-caps text-muted-foreground">
        <span>Cash flow</span>
        <InfoTooltip label="About this figure">
          Average monthly dividend income over the next 12 months, after dividend tax when a rate is
          set in Settings.
        </InfoTooltip>
      </div>
      <div className="stat-num mt-2.5">
        {monthly ? formatMoneyWhole(monthly) : "—"}{" "}
        <span className="font-body text-sm text-muted-foreground">/ mo</span>
      </div>
      <div className="mt-auto flex flex-col gap-1.5 border-t border-hairline-faint pt-3">
        {rows.length === 0 ? (
          <div className="text-xs text-muted-foreground">No upcoming payments</div>
        ) : (
          rows.map((r) => (
            <div
              key={`${r.symbol}-${r.date}`}
              data-testid="upcoming-row"
              className="flex items-center justify-between text-xs"
            >
              <span className="text-muted-foreground">
                <span
                  data-testid={`cashflow-symbol-${r.symbol}`}
                  className="font-medium text-foreground"
                >
                  {r.symbol}
                </span>{" "}
                · {formatDate(r.date)}
              </span>
              <span className="font-mono tabular-nums">{formatMoney(r.amount)}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
