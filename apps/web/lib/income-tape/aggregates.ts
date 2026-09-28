import { monthKeyOfDay, yearOfDay, yearStartDay, type TapePoint } from "./points";
import type { Measure } from "./ranges";
import type { Extent } from "./viewport";

export interface Totals {
  total: number;
  paid: number;
  confirmed: number;
  estimated: number;
  count: number;
}

const empty = (): Totals => ({ total: 0, paid: 0, confirmed: 0, estimated: 0, count: 0 });

function add(t: Totals, p: TapePoint): void {
  t.total += p.amount;
  t[p.certainty] += p.amount;
  t.count += 1;
}

function inMeasure(p: TapePoint, m: Measure): boolean {
  return m.kind === "window" ? p.day >= m.from && p.day < m.to : p.headline === m.tag;
}

export function measureTotals(points: TapePoint[], m: Measure, focus: string | null): Totals {
  const t = empty();
  for (const p of points) if ((!focus || p.symbol === focus) && inMeasure(p, m)) add(t, p);
  return t;
}

/** Percent change, or null when there is nothing to compare with — a new payer
 *  is "new", never "+∞%". */
export function changePct(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return (cur / prev - 1) * 100;
}

export function monthTotals(points: TapePoint[], focus: string | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of points) {
    if (focus && p.symbol !== focus) continue;
    const k = monthKeyOfDay(p.day);
    out.set(k, (out.get(k) ?? 0) + p.amount);
  }
  return out;
}

export function yearTotals(points: TapePoint[], focus: string | null): Map<number, Totals> {
  const out = new Map<number, Totals>();
  for (const p of points) {
    if (focus && p.symbol !== focus) continue;
    const y = yearOfDay(p.day);
    const t = out.get(y) ?? empty();
    add(t, p);
    out.set(y, t);
  }
  return out;
}

export function indexBySymbol(points: TapePoint[]): Map<string, TapePoint[]> {
  const out = new Map<string, TapePoint[]>();
  for (const p of points) {
    const list = out.get(p.symbol) ?? [];
    list.push(p);
    out.set(p.symbol, list);
  }
  return out;
}

const GHOST_TOLERANCE_DAYS = 25;

/** The same payer's payment about a year earlier: within ±25 days of p − 365.
 *  Pay dates drift a few days year to year; the latest match wins. */
export function ghostOf(p: TapePoint, index: Map<string, TapePoint[]>): TapePoint | null {
  let best: TapePoint | null = null;
  for (const q of index.get(p.symbol) ?? []) {
    if (q === p) continue;
    if (Math.abs(q.day - (p.day - 365)) <= GHOST_TOLERANCE_DAYS) best = q;
  }
  return best;
}

export interface PayerRank {
  symbol: string;
  next12: number;
}

function sumWhere(points: TapePoint[], pred: (p: TapePoint) => boolean): number {
  let s = 0;
  for (const p of points) if (pred(p)) s += p.amount;
  return s;
}

const isNext12 = (todayDay: number) => (p: TapePoint) =>
  p.day > todayDay && p.day <= todayDay + 365;
const isLast12 = (todayDay: number) => (p: TapePoint) =>
  p.day > todayDay - 365 && p.day <= todayDay;

/** Every payer the tape draws, largest next-12-month income first; payers with
 *  history only (sold) follow, by symbol. */
export function rankPayers(points: TapePoint[], todayDay: number): PayerRank[] {
  const bySymbol = indexBySymbol(points);
  return [...bySymbol.entries()]
    .map(([symbol, ps]) => ({ symbol, next12: sumWhere(ps, isNext12(todayDay)) }))
    .sort((a, b) => b.next12 - a.next12 || a.symbol.localeCompare(b.symbol));
}

export interface PayerSummary {
  symbol: string;
  next: TapePoint | null;
  last12: number;
  next12: number;
  /** Last 12 months against the 12 before; null for a payer new to the book. */
  changePct: number | null;
  /** Share of the book's next-12-month income. */
  share: number | null;
  frequency: string | null;
}

export function payFrequency(perYear: number): string | null {
  if (perYear >= 11) return "pays monthly";
  if (perYear >= 4) return "pays quarterly";
  if (perYear === 3) return "pays three times a year";
  if (perYear === 2) return "pays twice a year";
  if (perYear === 1) return "pays once a year";
  return null;
}

export function payerSummary(points: TapePoint[], symbol: string, todayDay: number): PayerSummary {
  const mine = points.filter((p) => p.symbol === symbol);
  const last12 = sumWhere(mine, isLast12(todayDay));
  const prior12 = sumWhere(mine, (p) => p.day > todayDay - 730 && p.day <= todayDay - 365);
  const next12 = sumWhere(mine, isNext12(todayDay));
  const bookNext12 = sumWhere(points, isNext12(todayDay));
  const countNext = mine.filter(isNext12(todayDay)).length;
  const countLast = mine.filter(isLast12(todayDay)).length;
  return {
    symbol,
    next: mine.find((p) => p.day > todayDay) ?? null,
    last12,
    next12,
    changePct: changePct(last12, prior12),
    share: bookNext12 > 0 ? next12 / bookNext12 : null,
    frequency: payFrequency(Math.max(countNext, countLast)),
  };
}

/** A year the tape only partly covers: the first (the book started after
 *  1 January) or the last (the forecast ends before 31 December). */
export function isPartialYear(year: number, extent: Extent): boolean {
  if (year === yearOfDay(extent.firstDay) && extent.firstDay > yearStartDay(year)) return true;
  if (year === yearOfDay(extent.lastDay) && extent.lastDay < yearStartDay(year + 1) - 1)
    return true;
  return false;
}
