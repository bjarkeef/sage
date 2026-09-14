import { Delta } from "@sage/ui";
import { formatDate, formatMoney, moneyToNumber } from "../../lib/format";
import { netFactor } from "../../lib/dividend-tax";
import type { IncomeStreamPointDTO, MoneyDTO, PaymentCertainty } from "../../lib/types";

/**
 * What the book pays, with the parts that are not the figure stepped down.
 *
 * The lead used to be net worth, at 108px. It is now forward income, at 56px,
 * and both halves of that change matter.
 *
 * *What*: `goal-band.tsx` has said since it shipped that "a dividend account is
 * not run for its net worth — the front page opens with a number that is not
 * the point", and the page opened with it anyway. The balance is still here, as
 * a supporting stat under the stream. It is simply no longer the answer to a
 * question nobody asked.
 *
 * *How big*: none of the apps this design is measured against ships a hero
 * numeral — Fey's is ~18px, Monarch's ~28px, shadcn's ~30px, and the 48-54px
 * that `SAGE_vision.md` cites was measured off Fey's marketing site rather than
 * its app. The cost of 108px was structural rather than aesthetic: once the
 * lead is that loud, the next tier has to be set at 32px to register at all,
 * so a row of footnotes ended up the same size as the cards below and nothing
 * on the page read as secondary.
 */
function IncomeMoney({ money }: { money: MoneyDTO }) {
  const parts = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(Number(money.amount));
  return (
    <span className="horizon-num">
      {parts.map((part, i) =>
        part.type === "currency" ? (
          <span key={i} className="pr-1.5 align-baseline text-lg font-light text-muted-foreground">
            {part.value}
          </span>
        ) : part.type === "decimal" || part.type === "fraction" ? (
          <span key={i} className="text-muted-foreground/70">
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </span>
  );
}

const CERTAINTY_WORD: Record<PaymentCertainty, string> = {
  paid: "paid",
  confirmed: "confirmed",
  estimated: "estimated",
};

function scale(m: MoneyDTO, f: number): MoneyDTO {
  return { amount: (moneyToNumber(m) * f).toFixed(2), currency: m.currency };
}

export function OverviewHero({
  income,
  trailing,
  taxRate,
  paymentsAhead,
  hovered,
  brief,
}: {
  /** Forward twelve months, gross. Netted here, so the figure and the stream
   *  beneath it are on the same footing. */
  income: MoneyDTO | null;
  /** Trailing twelve months, gross — the basis for "on last year". Null on a
   *  book with no year behind it, in which case no comparison is drawn rather
   *  than one measured against zero. */
  trailing: MoneyDTO | null;
  taxRate: number | null;
  paymentsAhead: number;
  /** The payment under the pointer on the stream below, when there is one.
   *  The figure and the stream are one instrument: the readout replaces the
   *  summary line rather than floating over it in a tooltip. */
  hovered?: IncomeStreamPointDTO | null;
  /** The day's line. Beneath the figure, because a sentence set large enough
   *  to lead competes with the figure for the same job and the figure wins. */
  brief?: React.ReactNode;
}) {
  const f = netFactor(taxRate);
  const net = income ? scale(income, f) : null;
  const change = income && trailing ? (moneyToNumber(income) - moneyToNumber(trailing)) * f : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="label-caps mb-2.5 text-muted-foreground">Income · next twelve months</p>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          {net ? <IncomeMoney money={net} /> : <span className="horizon-num">—</span>}
          {hovered ? (
            // The payment replaces the summary: "18 payments ahead" is a claim
            // about the whole forward window, and while the pointer is on last
            // March it reads as a caption for the mark under it.
            <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium">{hovered.symbol}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatMoney(scale({ amount: hovered.amount, currency: hovered.currency }, f))}
              </span>
              <span className="text-muted-foreground">
                {formatDate(hovered.date, { year: "always" })} · {CERTAINTY_WORD[hovered.certainty]}
              </span>
            </span>
          ) : (
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              {change != null && income && (
                <span className="flex items-baseline gap-1.5">
                  <Delta value={change} currency={income.currency} />
                  <span className="text-muted-foreground">on last year</span>
                </span>
              )}
              {paymentsAhead > 0 && (
                <span className="text-income">
                  {paymentsAhead} payment{paymentsAhead === 1 ? "" : "s"} ahead
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {brief}
    </div>
  );
}
