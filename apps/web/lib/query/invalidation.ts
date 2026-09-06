import type { QueryClient } from "@tanstack/react-query";

type MutationKind =
  | "transaction"
  | "holdings"
  | "import"
  | "dividend-sync"
  | "currency"
  | "overview-prefs"
  | "dividend-tax-rate"
  | "allow-negative-dividend-growth"
  | "categories";

const PORTFOLIO_WIDE = [
  "dashboard",
  "portfolio",
  "performance",
  "dividend-income",
  "diversification",
  "transactions",
  "asset-detail",
  "categories",
  // An import can introduce a split transaction where there was none, or add
  // trades that newly land on a stored bar. With a 300s `staleTime`,
  // /corporate-actions would otherwise keep showing "No corporate actions"
  // for up to five minutes after the ledger it reports on just changed.
  "corporate-actions",
  // `system-status` carries `pricesMissing`, which counts held symbols with no
  // stored price — so changing what is held changes it. Without this, the
  // degraded-prices banner keeps showing a reading taken moments earlier: an
  // import creates instruments before their first price is fetched, the status
  // query caches `pricesMissing > 0` for its 60s staleTime, and the notice
  // "Prices are unavailable" then sits above rows quoting live prices.
  "system-status",
] as const;

const MAP: Record<MutationKind, readonly string[]> = {
  transaction: PORTFOLIO_WIDE,
  holdings: PORTFOLIO_WIDE,
  import: PORTFOLIO_WIDE,
  "dividend-sync": ["dividend-income", "dashboard"],
  // `system-status` carries the FX block, which is display-currency-derived:
  // it reports the pairs the book has to convert, so switching currency
  // changes the whole answer.
  currency: [
    "dashboard",
    "diversification",
    "portfolio-history",
    "user-settings",
    "categories",
    "system-status",
  ],
  "overview-prefs": ["user-settings", "dashboard"],
  "dividend-tax-rate": ["user-settings", "dividend-income"],
  "allow-negative-dividend-growth": ["user-settings", "goal"],
  categories: ["categories"],
};

/** Invalidate every query-key family affected by a mutation. Prefix-matches on
 *  the first key segment, so all variants (currencies/ranges) are refreshed. */
export async function invalidateFor(
  queryClient: QueryClient,
  mutation: MutationKind,
): Promise<void> {
  await Promise.all(
    MAP[mutation].map((prefix) => queryClient.invalidateQueries({ queryKey: [prefix] })),
  );
}
