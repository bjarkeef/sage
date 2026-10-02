import { Card, CardTitle, SectionHeader, Stat } from "@sage/ui";
import { formatDate, formatMoney } from "../../../../lib/format";
import { netFactor } from "../../../../lib/dividend-tax";
import {
  cashDate,
  nextPayment,
  nextTwelveMonths,
  payFrequencyOf,
} from "../../../../lib/asset-page/figures";
import { basisWord, formatPct } from "../../../../lib/asset-page/labels";
import type { AssetDetailDTO } from "../../../../lib/types";
import { CustomIncomeCard } from "./custom-income-card";
import { IncomeByYear } from "./income-by-year";
import { PaymentsList } from "./payments-list";
import { CheckMark, Missing } from "./reliability-marks";

/** Wide figures wrap inside their cell rather than push the page sideways. */
const WRAP = "break-words [overflow-wrap:anywhere]";

/** What this holding pays YOU: amounts for your shares, after tax. */
export function YourIncome({
  detail,
  taxRate,
  todayISO,
}: {
  detail: AssetDetailDTO;
  taxRate: number | null;
  todayISO: string;
}) {
  const { position, upcoming, income, dividends } = detail;
  if (!position.held || !position.quantity) return null;
  const qty = Number(position.quantity);
  const f = netFactor(taxRate);
  const basis = basisWord(taxRate);

  const next12 = nextTwelveMonths(upcoming, qty);
  const next = nextPayment(upcoming, todayISO);
  const freq = payFrequencyOf(dividends.history, upcoming, todayISO);
  // Cash that actually landed, from the ledger — the rows /dividends lists as
  // received, and /holdings' dividend income (Task 3). Gross; netted here.
  const received = position.dividendsReceived ?? null;
  const receivedAmount = received ? Number(received.amount) : 0;

  return (
    <Card className="min-w-0">
      <CardTitle meta={basis}>Your income</CardTitle>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
        <Stat
          size="sm"
          label="Next payment"
          value={
            next ? (
              <span className={`text-income ${WRAP}`}>
                {formatMoney({
                  amount: (Number(next.amountPerShare) * qty * f).toFixed(2),
                  currency: next.currency,
                })}
              </span>
            ) : (
              <Missing reason="No payment expected yet" />
            )
          }
          context={
            next
              ? `${formatDate(cashDate(next), { year: "always" })} · ${next.certainty}`
              : undefined
          }
        />
        <Stat
          size="sm"
          label="Next 12 months"
          value={
            next12.ok ? (
              <span className={`text-income ${WRAP}`}>
                {formatMoney({
                  amount: (Number(next12.value.amount) * f).toFixed(2),
                  currency: next12.value.currency,
                })}
              </span>
            ) : (
              <Missing reason={next12.reason} />
            )
          }
          context={basis}
        />
        <Stat
          size="sm"
          label="Yield on cost"
          value={
            income.yieldOnCost != null ? (
              <span className={WRAP}>{formatPct(income.yieldOnCost * f)}</span>
            ) : (
              <Missing reason="No trailing dividend to measure against your cost" />
            )
          }
          context={income.yieldOnCost != null ? basis : undefined}
        />
        <Stat
          size="sm"
          label="Received so far"
          value={
            received && receivedAmount > 0 ? (
              <>
                <span className={WRAP}>
                  {formatMoney({
                    amount: (receivedAmount * f).toFixed(2),
                    currency: received.currency,
                  })}
                </span>
                {received.leftOut > 0 && (
                  <CheckMark
                    flag={{
                      reason: `${received.leftOut} payment${received.leftOut === 1 ? " in another currency is" : "s in another currency are"} left out: no exchange rate`,
                    }}
                  />
                )}
              </>
            ) : (
              "Nothing yet"
            )
          }
          context={received && receivedAmount > 0 ? basis : undefined}
        />
        <Stat
          size="sm"
          label="Pays"
          value={
            freq ? (
              freq.replace(/^pays /, "")
            ) : (
              <Missing reason="Too few payments to tell its rhythm" />
            )
          }
        />
      </div>
      <PaymentsList history={dividends.history} />
    </Card>
  );
}

/**
 * § 4, "What it pays you": the per-share history and forecast by year beside
 * what that means for your shares. A custom holding keeps its own income card.
 * A holding that has never paid has nothing to say here, so nothing mounts.
 */
export function IncomeSection({
  detail,
  taxRate,
  todayISO,
}: {
  detail: AssetDetailDTO;
  taxRate: number | null;
  todayISO: string;
}) {
  // A custom holding's income is contractual (annualDividend = price × rate), so
  // the per-share reliability checks never run for it: it returns here.
  if (detail.custom) {
    if (!detail.custom.income) return null;
    return (
      <section className="mb-10">
        <SectionHeader title="What it pays you" />
        <CustomIncomeCard income={detail.custom.income} />
      </section>
    );
  }

  const { dividends, upcoming, income, profile, position } = detail;
  if (dividends.history.length === 0 && upcoming.length === 0) return null;
  const currency =
    income.annualDividend?.currency ??
    dividends.history[0]?.currency ??
    upcoming[0]?.currency ??
    profile.currency;
  const held = position.held && position.quantity != null;

  return (
    <section className="mb-10">
      <SectionHeader title="What it pays you" />
      <div className="grid gap-4 lg:grid-cols-2">
        <IncomeByYear
          history={dividends.history}
          upcoming={upcoming}
          currency={currency}
          cagr5y={dividends.cagr5y}
          annualDividend={income.annualDividend}
          todayISO={todayISO}
          footer={held ? null : <PaymentsList history={dividends.history} />}
        />
        {held && <YourIncome detail={detail} taxRate={taxRate} todayISO={todayISO} />}
      </div>
    </section>
  );
}
