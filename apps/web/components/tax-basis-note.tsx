import Link from "next/link";

/**
 * States the tax basis for every figure on the page, once, at the top.
 *
 * On `/dividends/analytics` this is no longer the page's only basis marker:
 * `IncomeTimeline`, `ForwardPayments`, `YieldByHolding`, and `MonthlyRhythm`
 * each carry their own `BasisChip` in the card title row, so a reader
 * looking at just one of those four cards doesn't have to scroll up to this
 * note to know its basis. The KPI row (`AnnualIncomeCard`/`YieldCard`/
 * `CashFlowCard`), `IncomeComposition`, `GrowthLeaders`, and
 * `HoldingsDividendTable` carry no chip of their own and still rely
 * entirely on this note — so the page currently states its basis at two
 * granularities depending which card you're looking at. Narrowing that gap
 * (chips everywhere, or nowhere) is a separate design decision, not made by
 * this docblock.
 *
 * Passed through `PageHeader`'s `description` prop as its sub-title — it
 * renders no block element of its own so it inherits that slot's muted
 * sub-title typography instead of introducing a second sub-title size.
 *
 * Only for pages where the claim is true of ALL figures — not Overview or the
 * asset page, which mix untaxed portfolio values with income.
 */
export function TaxBasisNote({ rate }: { rate: number | null }) {
  return rate == null ? (
    <>
      Figures are before tax — set a dividend tax rate in{" "}
      <Link
        href="/settings"
        className="underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        Settings
      </Link>
      .
    </>
  ) : (
    <>
      Income and yields after {rate}% dividend tax. Per-share amounts are as declared.{" "}
      <Link
        href="/settings"
        className="underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        Change in Settings
      </Link>
    </>
  );
}
