import type { MoneyDTO } from "../types";

/** "consumer_cyclical" → "Consumer Cyclical". */
export function prettySector(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A per-share dividend as money, 2 to 4 decimals: "$1.50", "€0.6749".
 *  Never the raw provider string ("0.67492 EUR"). */
export function formatPerShare(dto: MoneyDTO): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: dto.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(dto.amount));
}

/** A fraction as a percent: 0.0217 → "2.17%". */
export function formatPct(fraction: number, digits = 2): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** A change already in percent, signed, with a true minus: "+2.1%", "−9.8%". */
export function signedPct(pct: number, digits = 1): string {
  const r = Number(pct.toFixed(digits));
  if (r === 0) return `${(0).toFixed(digits)}%`;
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(digits)}%`;
}

export function basisWord(taxRate: number | null): "after tax" | "before tax" {
  return taxRate != null ? "after tax" : "before tax";
}

/** A provider string that actually says something — not null, blank or a lone dash. */
export function isFilled(v: string | null | undefined): v is string {
  return v != null && !/^\s*[-–—]?\s*$/.test(v);
}

/** A provider figure sent as a string that is a real, positive number: not
 *  "0", not "NaN", not blank. A zero count of employees or assets is the
 *  provider's gap, not a fact. */
export function isPositiveFigure(v: string | null | undefined): v is string {
  if (v == null || v.trim() === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}
