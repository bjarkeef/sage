import type { ReactNode } from "react";
import { Card, CardTitle, toneForValue } from "@sage/ui";
import { CERTAINTY_FILL } from "../../../../components/charts/certainty-bars";
import { cutNotes, perShareByYear, type YearBar } from "../../../../lib/asset-page/income-by-year";
import { checkTrailingSum } from "../../../../lib/asset-page/reliability";
import { formatPerShare, signedPct } from "../../../../lib/asset-page/labels";
import type { AssetDividendsDTO, AssetUpcomingDTO, MoneyDTO } from "../../../../lib/types";
import { CheckMark } from "./reliability-marks";

function YearColumn({ bar, max, currency }: { bar: YearBar; max: number; currency: string }) {
  const h = (v: number) => `${max > 0 ? (v / max) * 100 : 0}%`;
  const total = formatPerShare({ amount: bar.total.toFixed(4), currency });
  const label = `${bar.year}: ${total} per share${bar.kind === "forecast" ? ", forecast" : ""}${bar.cutPct != null ? `, cut ${Math.round(-bar.cutPct)}%` : ""}`;
  return (
    <div
      role="listitem"
      aria-label={label}
      title={label}
      className="flex h-full min-w-0 flex-1 flex-col items-center gap-1"
    >
      <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:block">
        {bar.total > 0 ? total : " "}
      </span>
      <div className="flex w-full max-w-10 flex-1 flex-col-reverse overflow-hidden rounded-badge">
        <div
          data-segment="paid"
          data-fill={bar.cutPct != null ? "loss" : "paid"}
          style={{
            height: h(bar.paid),
            background: bar.cutPct != null ? "var(--loss)" : CERTAINTY_FILL.paid,
          }}
        />
        <div
          data-segment="confirmed"
          data-fill="confirmed"
          style={{ height: h(bar.confirmed), background: CERTAINTY_FILL.confirmed }}
        />
        <div
          data-segment="estimated"
          data-fill="estimated"
          style={{ height: h(bar.estimated), background: CERTAINTY_FILL.estimated }}
        />
      </div>
      <span className="flex flex-col items-center whitespace-nowrap text-xs text-muted-foreground">
        <span aria-hidden className="sm:hidden" data-testid="year-short">
          {"'" + String(bar.year).slice(2) + (bar.partial ? "*" : "")}
        </span>
        <span className="hidden sm:inline" data-testid="year-full">
          {String(bar.year) + (bar.partial ? "*" : "")}
        </span>
        {bar.flag && <CheckMark flag={bar.flag} />}
      </span>
    </div>
  );
}

/**
 * Dividend per share by calendar year — the issuer's declared amounts, gross —
 * in the certainty ramp: past years paid, this year paid plus still to come,
 * one forecast year. A complete year that paid less than the one before is
 * filled with the loss tone and named under the bars.
 */
export function IncomeByYear({
  history,
  upcoming,
  currency,
  cagr5y,
  annualDividend,
  todayISO,
  footer,
}: {
  history: AssetDividendsDTO["history"];
  upcoming: AssetUpcomingDTO[];
  currency: string;
  cagr5y: string | null;
  annualDividend: MoneyDTO | null;
  todayISO: string;
  footer?: ReactNode;
}) {
  const { years, leftOut } = perShareByYear({ history, upcoming, currency, todayISO });
  if (years.length === 0) return null;
  const max = Math.max(...years.map((y) => y.total));
  const trailing = checkTrailingSum(history, annualDividend, todayISO);
  const growth = cagr5y != null ? Number(cagr5y) * 100 : null;
  const notes = cutNotes(years);
  const growthTone = growth != null ? toneForValue(Number(growth.toFixed(1))) : null;

  return (
    <Card className="min-w-0">
      <CardTitle
        meta={
          <>
            gross, per share
            {!trailing.ok && trailing.annual != null && (
              <CheckMark
                flag={{
                  reason: `The last 12 months of payments add up to ${formatPerShare({ amount: trailing.trailing.toFixed(4), currency })}, but the trailing total says ${formatPerShare({ amount: trailing.annual.toFixed(4), currency })}.`,
                }}
              />
            )}
          </>
        }
      >
        Per share, by year
      </CardTitle>
      <div
        role="list"
        aria-label="Dividend per share by year"
        className="flex h-40 items-end gap-1.5"
      >
        {years.map((bar) => (
          <YearColumn key={bar.year} bar={bar} max={max} currency={currency} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(["paid", "confirmed", "estimated"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <i
              aria-hidden
              className="h-2.5 w-2.5 rounded-badge"
              style={{ background: CERTAINTY_FILL[k] }}
            />
            {k[0]!.toUpperCase() + k.slice(1)}
          </span>
        ))}
        {notes.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <i
              aria-hidden
              className="h-2.5 w-2.5 rounded-badge"
              style={{ background: "var(--loss)" }}
            />
            Cut
          </span>
        )}
      </div>
      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
        {growth != null && (
          <p className="tabular-nums">
            5-yr growth{" "}
            <span
              data-tone={growthTone}
              className={
                growthTone === "gain"
                  ? "text-gain"
                  : growthTone === "loss"
                    ? "text-loss"
                    : "text-neutral"
              }
            >
              {signedPct(growth)}
            </span>
            /yr
          </p>
        )}
        {years.some((y) => y.partial) && (
          <p className="text-xs">
            * part year — history starts part-way through it, so no cut is measured from it.
          </p>
        )}
        {leftOut > 0 && (
          <p className="text-xs">{`${leftOut} ${leftOut === 1 ? "payment" : "payments"} in another currency left out.`}</p>
        )}
      </div>
      {footer}
    </Card>
  );
}
