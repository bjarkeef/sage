import type { IncomeStreamPointDTO, PaymentCertainty } from "../types";
import { netFactor } from "../dividend-tax";

export const DAY_MS = 86_400_000;

export type HeadlineTag = "trailing" | "forward" | null;

/** One payment on the tape. Days are whole UTC days since 1970-01-01, so the
 *  geometry is plain arithmetic and never touches a timezone. */
export interface TapePoint {
  day: number;
  iso: string;
  symbol: string;
  /** Net of dividend tax, in the display currency. */
  amount: number;
  certainty: PaymentCertainty;
  headline: HeadlineTag;
}

export function isoToDay(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS;
}

export function dayToIso(day: number): string {
  return new Date(Math.round(day) * DAY_MS).toISOString().slice(0, 10);
}

export function yearStartDay(year: number): number {
  return Date.UTC(year, 0, 1) / DAY_MS;
}

export function yearOfDay(day: number): number {
  return new Date(Math.floor(day) * DAY_MS).getUTCFullYear();
}

export function monthKeyOfDay(day: number): number {
  const d = new Date(Math.floor(day) * DAY_MS);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function monthKeyStartDay(key: number): number {
  return Date.UTC(Math.floor(key / 12), key % 12, 1) / DAY_MS;
}

/** The same calendar date a year earlier; 29 February maps to 28 February. */
export function sameDayLastYear(day: number): number {
  const d = new Date(Math.floor(day) * DAY_MS);
  const y = d.getUTCFullYear() - 1;
  const m = d.getUTCMonth();
  const lastOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), lastOfMonth)) / DAY_MS;
}

export function toTapePoints(points: IncomeStreamPointDTO[], taxRate: number | null): TapePoint[] {
  const f = netFactor(taxRate);
  return points
    .map((p) => ({
      day: isoToDay(p.date),
      iso: p.date,
      symbol: p.symbol,
      amount: Number(p.amount) * f,
      certainty: p.certainty,
      headline: p.headline,
    }))
    .sort((a, b) => a.day - b.day);
}
