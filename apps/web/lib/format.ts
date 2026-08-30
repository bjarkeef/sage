import type { MoneyDTO } from "./types";

/**
 * Display-only: a process uptime in seconds as a compact duration.
 *
 * Keeps exactly one unit of detail below the leading unit ("2h 14m"), and
 * stays in seconds below a minute so a just-restarted API reads as obviously
 * fresh rather than rounding to "0m". A negative or non-finite reading is
 * reported as unknown instead of rendering nonsense.
 */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Display-only: format a money DTO as a localized currency string. */
export function formatMoney(dto: MoneyDTO, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: dto.currency }).format(
    Number(dto.amount),
  );
}

/** Display-only: like `formatMoney` but with no minor units — for big hero
 *  figures (annual/forward income, monthly cash flow) where the cents are
 *  false precision on a projected number and just add visual noise. */
export function formatMoneyWhole(dto: MoneyDTO, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: dto.currency,
    maximumFractionDigits: 0,
  }).format(Number(dto.amount));
}

/** Display-only numeric conversion (e.g. for Delta). Never use for math. */
export function moneyToNumber(dto: MoneyDTO): number {
  return Number(dto.amount);
}

/** Display-only: trim a decimal quantity/price string to at most 4 decimal
 *  places with trailing zeros removed. Never use for math or edit inputs. */
export function formatQuantity(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** Display-only: a signed percentage, "+3.42%" / "-1.10%". The explicit plus is
 *  the DESIGN.md delta grammar — an unsigned gain reads as a bare measurement.
 *  For a figure that also carries an absolute amount, use `<Delta>` instead of
 *  hand-assembling the pair. */
export function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Display-only: human date from an ISO day string — "May 11" (current year)
 *  or "May 11, 2026". ISO dates never render in the UI (DESIGN.md contract). */
export function formatDate(iso: string, opts?: { year?: "always" | "auto" }): string {
  const d = new Date(`${iso}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  const showYear = opts?.year === "always" || d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
  });
}

/** Display-only: compact "time ago" from a full ISO timestamp — "just now",
 *  "12m ago", "3h ago", "2d ago" — falling back to an absolute human date once
 *  it's a week or more old. `now` is injectable for deterministic tests. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (!Number.isFinite(then.getTime())) return iso;
  const secs = Math.round((now.getTime() - then.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso.slice(0, 10));
}

/** Display-only: compact large-number formatting for financial magnitudes,
 *  e.g. "3.00T" for market cap. */
export function formatLargeNumber(val: string): string {
  const n = Number(val);
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}

/** Compact currency, e.g. "€7.79B" for assets under management. */
export function formatCompactMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

/** Display names for the market-data provider keys the composition root
 *  registers. Shared by the Settings System card and the holdings callout so
 *  the two surfaces never drift on what a provider is called. */
const PROVIDER_LABELS: Record<string, string> = {
  yahoo: "Yahoo",
  eodhd: "EODHD",
};

/** Display-only: human name for a provider key, e.g. "eodhd" -> "EODHD".
 *  Falls back to the raw key for anything not in the map. */
export function providerLabel(name: string): string {
  return PROVIDER_LABELS[name] ?? name;
}

/**
 * Display-only: "12s ago" / "4h ago" / "—" from a count of elapsed seconds.
 *
 * Deliberately takes elapsed seconds rather than a timestamp — the caller
 * (the System card's provider health rows) computes the age on the server,
 * so this never touches the browser clock, and a stale reading can never be
 * mistaken for a live one just because two clocks disagree.
 */
export function formatSecondsAgo(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
