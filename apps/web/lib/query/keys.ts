export const qk = {
  dashboard: (currency?: string | null) => ["dashboard", currency ?? null] as const,
  portfolio: () => ["portfolio"] as const,
  performance: (range: string) => ["performance", range] as const,
  portfolioHistory: (range: string, currency?: string | null, benchmarks?: string[]) =>
    ["portfolio-history", range, currency ?? null, benchmarks ?? []] as const,
  assetDetail: (slug: string) => ["asset-detail", slug] as const,
  assetChart: (slug: string, range: string) => ["asset-chart", slug, range] as const,
  assetNews: (slug: string) => ["asset-news", slug] as const,
  assetRatings: (slug: string) => ["asset-ratings", slug] as const,
  dividendIncome: () => ["dividend-income"] as const,
  diversification: (currency?: string | null) => ["diversification", currency ?? null] as const,
  portfolioNews: () => ["portfolio-news"] as const,
  transactions: () => ["transactions"] as const,
  /** Deliberately prefixed with "transactions": react-query matches
   *  invalidation by key prefix, so the existing `transaction` family
   *  invalidation sweeps the per-symbol lists too. A key like
   *  ["symbol-transactions", …] would silently go stale after a write. */
  symbolTransactions: (symbol: string) => ["transactions", "symbol", symbol] as const,
  userSettings: () => ["user-settings"] as const,
  goal: () => ["goal"] as const,
  customHolding: (symbol: string) => ["custom-holding", symbol] as const,
  categoriesView: (currency?: string | null) => ["categories", currency ?? null] as const,
  systemStatus: () => ["system-status"] as const,
};
