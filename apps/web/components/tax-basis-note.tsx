import Link from "next/link";

/**
 * States the tax basis for every figure on the page. This replaces per-card
 * "· after tax" suffixes: the basis is stated once, prominently, instead of
 * eight times in caps eyebrows.
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
