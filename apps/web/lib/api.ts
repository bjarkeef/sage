import { isServer } from "@tanstack/react-query";
import type {
  PortfolioDTO,
  PortfolioHistoryDTO,
  SearchResultDTO,
  TransactionRow,
  CreateTransactionInput,
  UpdateTransactionInput,
  DividendIncomeDTO,
  AssetDetailDTO,
  ImportPreviewDTO,
  ImportResultDTO,
  DiversificationViewDTO,
  UserSettingsDTO,
  SystemDTO,
  OverviewPrefs,
  DashboardDTO,
  PerformanceDTO,
  GoalViewDTO,
  PutGoalInput,
  QuoteDTO,
  CustomHoldingInput,
  CustomHoldingDTO,
  CategoriesViewDTO,
  SaveCategoriesInput,
  NewsArticleDTO,
  AnalystRatingsDTO,
} from "./types";

export type PublicConfigDTO = {
  allowSignup: boolean;
  /** False until someone has claimed this instance by creating the first account. */
  hasAccounts: boolean;
  mode: "open" | "invite_only";
};

/** API base URL for server components (server-to-server). */
export function serverApiBase(): string {
  return process.env.SAGE_API_URL ?? "http://localhost:3001";
}

/** Unauthenticated instance flags (signup policy). Safe to call before login. */
export async function getPublicConfig(): Promise<PublicConfigDTO> {
  const base = isServer ? serverApiBase() : clientApiBase();
  const res = await fetch(`${base}/public-config`, {
    cache: "no-store",
    ...(isServer ? {} : { credentials: "omit" as const }),
  });
  if (!res.ok) {
    // Fail open for signup UI if the API is mid-start; server still enforces ALLOW_SIGNUP.
    // Fail open for the signup UI if the API is mid-start; the server still
    // enforces ALLOW_SIGNUP. `hasAccounts: true` is the safe half of that
    // guess: it only suppresses the redirect to /sign-up, and showing the
    // sign-in form to a first visitor is recoverable, while bouncing a
    // returning user to a registration page is not.
    return { allowSignup: true, hasAccounts: true, mode: "open" };
  }
  return (await res.json()) as PublicConfigDTO;
}

/** API base URL for client components (browser). */
export function clientApiBase(): string {
  return process.env.NEXT_PUBLIC_SAGE_API_URL ?? "http://localhost:3001";
}

/** One fetch path for both environments: server forwards the request cookies
 *  (auth) via next/headers and disables Next's data cache (TanStack is the
 *  cache layer); the browser sends credentialed requests to the public base. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (isServer) {
    const { cookies } = await import("next/headers");
    const cookie = (await cookies()).toString();
    return fetch(`${serverApiBase()}${path}`, {
      ...init,
      cache: "no-store",
      headers: { ...init?.headers, cookie },
    });
  }
  return fetch(`${clientApiBase()}${path}`, { ...init, credentials: "include" });
}

export async function getPortfolio(): Promise<PortfolioDTO> {
  const res = await apiFetch("/portfolio");
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`portfolio fetch failed: ${res.status}`);
  return (await res.json()) as PortfolioDTO;
}

export async function getDashboard(currency?: string): Promise<DashboardDTO> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : "";
  const res = await apiFetch(`/dashboard${qs}`);
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`dashboard fetch failed: ${res.status}`);
  return (await res.json()) as DashboardDTO;
}

export async function getPerformance(range?: string): Promise<PerformanceDTO> {
  const qs = range ? `?range=${encodeURIComponent(range)}` : "";
  const res = await apiFetch(`/performance${qs}`);
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`performance fetch failed: ${res.status}`);
  return (await res.json()) as PerformanceDTO;
}

export async function searchInstruments(q: string): Promise<SearchResultDTO[]> {
  const res = await fetch(`${clientApiBase()}/instruments/search?q=${encodeURIComponent(q)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return (await res.json()) as SearchResultDTO[];
}

export async function getInstrumentQuote(symbol: string): Promise<QuoteDTO | null> {
  try {
    const res = await fetch(`${clientApiBase()}/instruments/${encodeURIComponent(symbol)}/quote`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return (await res.json()) as QuoteDTO;
  } catch {
    return null;
  }
}

export async function createTransaction(input: CreateTransactionInput): Promise<{ id: string }> {
  const res = await fetch(`${clientApiBase()}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  if (!res.ok) {
    // The API already says what went wrong; collapsing every failure into one
    // sentence throws that away and leaves the user at a dead end.
    const detail = (await res.json().catch(() => ({}))) as {
      error?: string;
      symbol?: string;
      expected?: string;
      got?: string;
    };
    if (detail.error === "oversell") throw new Error("That sell exceeds your holdings.");
    if (detail.error === "currency_mismatch" && detail.expected && detail.got) {
      throw new Error(
        `${detail.symbol ?? "This holding"} is bought and sold in ${detail.expected}, but ` +
          `this transaction is in ${detail.got}. Buys and sells have to share one ` +
          `currency; dividends can settle in another.`,
      );
    }
    throw new Error("Could not save the transaction.");
  }
  return (await res.json()) as { id: string };
}

export type TransactionsPage = {
  items: TransactionRow[];
  nextCursor: string | null;
};

/** Cursor-paginated ledger (default 50). Pass cursor from the previous page. */
export async function listTransactions(opts?: {
  limit?: number;
  cursor?: string | null;
  /** Restrict to one holding's entries (the asset page's ledger section). */
  symbol?: string;
}): Promise<TransactionsPage> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.symbol) params.set("symbol", opts.symbol);
  const qs = params.toString();
  const res = await apiFetch(`/transactions${qs ? `?${qs}` : ""}`);
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`transactions fetch failed: ${res.status}`);
  return (await res.json()) as TransactionsPage;
}

export async function deleteTransaction(id: string): Promise<void> {
  const res = await fetch(`${clientApiBase()}/transactions/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${res.status}`);
}

export async function updateTransaction(id: string, input: UpdateTransactionInput): Promise<void> {
  const res = await fetch(`${clientApiBase()}/transactions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      detail.error === "oversell"
        ? "That change exceeds your holdings."
        : "Could not update the transaction.",
    );
  }
}

export async function getPortfolioHistory(
  range: string,
  currency?: string,
  benchmarks?: string[],
): Promise<PortfolioHistoryDTO> {
  const params = new URLSearchParams({ range });
  if (currency) params.set("currency", currency);
  if (benchmarks && benchmarks.length > 0) params.set("benchmarks", benchmarks.join(","));
  const res = await apiFetch(`/portfolio/history?${params}`);
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`history fetch failed: ${res.status}`);
  return (await res.json()) as PortfolioHistoryDTO;
}

export async function syncDividends(): Promise<Record<string, number>> {
  const res = await fetch(`${clientApiBase()}/dividends/sync`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`dividend sync failed: ${res.status}`);
  return ((await res.json()) as { synced: Record<string, number> }).synced;
}

export async function removeHolding(symbol: string): Promise<void> {
  const res = await fetch(`${clientApiBase()}/portfolio/positions/${encodeURIComponent(symbol)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 404) throw new Error(`remove holding failed: ${res.status}`);
}

export async function getDividendIncome(): Promise<DividendIncomeDTO> {
  const res = await apiFetch("/dividends/income");
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`dividend income fetch failed: ${res.status}`);
  return (await res.json()) as DividendIncomeDTO;
}

export async function getAssetDetail(symbol: string): Promise<AssetDetailDTO> {
  const res = await apiFetch(`/asset/${encodeURIComponent(symbol)}`);
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`asset detail fetch failed: ${res.status}`);
  return (await res.json()) as AssetDetailDTO;
}

export async function getAssetChart(
  symbol: string,
  range: string,
): Promise<{ date: string; close: { amount: string; currency: string } }[]> {
  const params = new URLSearchParams({ range });
  const res = await apiFetch(`/asset/${encodeURIComponent(symbol)}/chart?${params}`);
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`asset chart fetch failed: ${res.status}`);
  const body = (await res.json()) as {
    chart: { date: string; close: { amount: string; currency: string } }[];
  };
  return body.chart;
}

export async function deleteAllHoldings(): Promise<void> {
  const res = await fetch(`${clientApiBase()}/portfolio/all`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`delete all failed: ${res.status}`);
}

export async function previewSnowballImport(file: File): Promise<ImportPreviewDTO> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${clientApiBase()}/import/snowball/preview`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`import preview failed: ${res.status}`);
  return (await res.json()) as ImportPreviewDTO;
}

export async function commitSnowballImport(
  file: File,
  restoreDeleted = false,
): Promise<ImportResultDTO> {
  const fd = new FormData();
  fd.append("file", file);
  if (restoreDeleted) fd.append("restoreDeleted", "true");
  const res = await fetch(`${clientApiBase()}/import/snowball/commit`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`import commit failed: ${res.status}`);
  return (await res.json()) as ImportResultDTO;
}

export type ImportTypeDTO = "buy" | "sell" | "dividend" | "split";

export type ColumnMappingDTO = {
  symbol: string;
  type: string;
  quantity: string;
  price: string;
  /** Null when the file has no currency column; defaultCurrency covers it. */
  currency: string | null;
  tradeDate: string;
  fee?: string | null;
  feeCurrency?: string | null;
  exchange?: string | null;
  name?: string | null;
  defaultCurrency?: string | null;
  defaultExchange?: string | null;
  /** Broker wording → Sage type, keyed by the normalized value. */
  typeAliases?: Record<string, ImportTypeDTO> | null;
  dateFormat?: "iso" | "dmy" | "mdy" | "auto";
};

export type ColumnValueSummaryDTO = {
  value: string;
  normalized: string;
  count: number;
  resolved: ImportTypeDTO | null;
};

export type CsvInspectDTO = {
  headers: string[];
  sampleRows: Record<string, string>[];
  rowCount: number;
  suggestedMapping: Partial<ColumnMappingDTO>;
  valuesByColumn: Record<string, ColumnValueSummaryDTO[]>;
  /** Set when the file belongs to a broker format with its own parser. */
  detectedFormat: "snowball" | null;
};

export async function inspectCsvImport(file: File): Promise<CsvInspectDTO> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${clientApiBase()}/import/csv/inspect`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`CSV inspect failed: ${res.status}`);
  return (await res.json()) as CsvInspectDTO;
}

export async function previewCsvImport(
  file: File,
  mapping: ColumnMappingDTO,
): Promise<ImportPreviewDTO> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mapping", JSON.stringify(mapping));
  const res = await fetch(`${clientApiBase()}/import/csv/preview`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`CSV preview failed: ${res.status}`);
  return (await res.json()) as ImportPreviewDTO;
}

export async function commitCsvImport(
  file: File,
  mapping: ColumnMappingDTO,
  restoreDeleted = false,
): Promise<ImportResultDTO> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mapping", JSON.stringify(mapping));
  if (restoreDeleted) fd.append("restoreDeleted", "true");
  const res = await fetch(`${clientApiBase()}/import/csv/commit`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      detail.error === "oversell"
        ? "Import would oversell a holding — check sell quantities."
        : `CSV import failed: ${res.status}`,
    );
  }
  return (await res.json()) as ImportResultDTO;
}

export async function getUserSettings(): Promise<UserSettingsDTO> {
  const res = await apiFetch("/user/settings");
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`settings fetch failed: ${res.status}`);
  return (await res.json()) as UserSettingsDTO;
}

export async function getSystemStatus(): Promise<SystemDTO> {
  const res = await apiFetch("/system");
  if (!res.ok) throw new Error(`system status fetch failed: ${res.status}`);
  return (await res.json()) as SystemDTO;
}

export async function updateDisplayCurrency(currency: string | null): Promise<void> {
  const res = await fetch(`${clientApiBase()}/user/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayCurrency: currency }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`settings update failed: ${res.status}`);
}

export async function updateDividendTaxRate(rate: number | null): Promise<void> {
  const res = await fetch(`${clientApiBase()}/user/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dividendTaxRate: rate }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`settings update failed: ${res.status}`);
}

export async function updateAutoAddDividends(value: boolean): Promise<void> {
  const res = await fetch(`${clientApiBase()}/user/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoAddDividends: value }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`settings update failed: ${res.status}`);
}

export async function updateAllowNegativeDividendGrowth(value: boolean): Promise<void> {
  const res = await fetch(`${clientApiBase()}/user/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ allowNegativeDividendGrowth: value }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`settings update failed: ${res.status}`);
}

export async function patchOverviewPrefs(prefs: Partial<OverviewPrefs>): Promise<void> {
  const res = await fetch(`${clientApiBase()}/user/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ overviewPrefs: prefs }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`settings update failed: ${res.status}`);
}

export async function getDiversification(currency?: string): Promise<DiversificationViewDTO> {
  const params = new URLSearchParams();
  if (currency) params.set("currency", currency);
  const qs = params.toString();
  const res = await apiFetch(`/portfolio/diversification${qs ? `?${qs}` : ""}`);
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`diversification fetch failed: ${res.status}`);
  return (await res.json()) as DiversificationViewDTO;
}

export async function getGoal(): Promise<GoalViewDTO> {
  const res = await apiFetch("/goal");
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`goal fetch failed: ${res.status}`);
  return (await res.json()) as GoalViewDTO;
}

export async function putGoal(input: PutGoalInput): Promise<GoalViewDTO> {
  const res = await fetch(`${clientApiBase()}/goal`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`goal save failed: ${res.status}`);
  return (await res.json()) as GoalViewDTO;
}

export async function deleteGoal(): Promise<void> {
  const res = await fetch(`${clientApiBase()}/goal`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`goal delete failed: ${res.status}`);
}

export async function createCustomHolding(input: CustomHoldingInput): Promise<{ symbol: string }> {
  const res = await apiFetch("/custom-holdings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`create custom holding failed: ${res.status}`);
  return (await res.json()) as { symbol: string };
}

export async function getCustomHolding(symbol: string): Promise<CustomHoldingDTO> {
  const res = await apiFetch(`/custom-holdings/${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`custom holding fetch failed: ${res.status}`);
  return (await res.json()) as CustomHoldingDTO;
}

export async function updateCustomHolding(
  symbol: string,
  input: Omit<CustomHoldingInput, "symbol" | "currency" | "initialPrice">,
): Promise<void> {
  const res = await apiFetch(`/custom-holdings/${encodeURIComponent(symbol)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`update custom holding failed: ${res.status}`);
}

export async function putPriceMark(
  symbol: string,
  mark: { date: string; price: string },
): Promise<void> {
  const res = await apiFetch(`/custom-holdings/${encodeURIComponent(symbol)}/prices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mark),
  });
  if (!res.ok) throw new Error(`price mark failed: ${res.status}`);
}

export async function getCategoriesView(currency?: string): Promise<CategoriesViewDTO> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : "";
  const res = await apiFetch(`/categories/view${qs}`);
  if (res.status === 401 && isServer) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!res.ok) throw new Error(`categories view failed: ${res.status}`);
  return (await res.json()) as CategoriesViewDTO;
}

export async function saveCategories(
  input: SaveCategoriesInput,
  currency?: string,
): Promise<CategoriesViewDTO> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : "";
  const res = await apiFetch(`/categories${qs}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `save categories failed: ${res.status}`);
  }
  return (await res.json()) as CategoriesViewDTO;
}

export async function getAssetNews(slug: string): Promise<NewsArticleDTO[]> {
  const res = await apiFetch(`/asset/${encodeURIComponent(slug)}/news`);
  if (!res.ok) throw new Error(`asset news fetch failed: ${res.status}`);
  return (await res.json()) as NewsArticleDTO[];
}

export async function getAssetRatings(slug: string): Promise<AnalystRatingsDTO | null> {
  const res = await apiFetch(`/asset/${encodeURIComponent(slug)}/ratings`);
  if (!res.ok) throw new Error(`asset ratings fetch failed: ${res.status}`);
  return (await res.json()) as AnalystRatingsDTO | null;
}

export async function getPortfolioNews(): Promise<NewsArticleDTO[]> {
  const res = await apiFetch(`/news`);
  if (!res.ok) throw new Error(`portfolio news fetch failed: ${res.status}`);
  return (await res.json()) as NewsArticleDTO[];
}

/** Downloads an export as a file. The API sets the filename in
 *  Content-Disposition; we honour it rather than inventing one client-side. */
async function downloadExport(path: string, fallbackName: string): Promise<void> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`export failed: ${res.status}`);

  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const name = match?.[1] ?? fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadTransactionsCsv(): Promise<void> {
  return downloadExport("/export/transactions.csv", "sage-transactions.csv");
}

export function downloadExportJson(): Promise<void> {
  return downloadExport("/export/data.json", "sage-export.json");
}
