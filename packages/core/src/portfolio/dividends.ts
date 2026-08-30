import { Decimal } from "../money/decimal";
import type { Money } from "../money/money";
import { comparePositionTransactions, type PositionTransaction } from "./positions";

export interface DividendHistoryRow {
  symbol: string;
  exDate: string;
  amountPerShare: string;
  currency: string;
  paymentDate?: string | null;
  paymentDateEstimated?: boolean;
  recordDate?: string | null;
  declarationDate?: string | null;
  period?: string | null;
}

export interface RetroactiveIncomeRow {
  symbol: string;
  exDate: string;
  paymentDate: string | null;
  paymentDateEstimated: boolean;
  amountPerShare: string;
  sharesHeld: string;
  income: string;
  currency: string;
}

/**
 * Build a timeline of shares held for a symbol from its transactions.
 * Returns sorted entries: [{ date, sharesAfter }].
 * Handles buy, sell (FIFO lot consumption for count), and split.
 */
export function buildSharesTimeline(
  transactions: PositionTransaction[],
): { date: Date; sharesAfter: Decimal }[] {
  const sorted = [...transactions].sort(comparePositionTransactions);
  const timeline: { date: Date; sharesAfter: Decimal }[] = [];
  let shares = new Decimal(0);

  for (const tx of sorted) {
    if (tx.type === "dividend") continue;
    if (tx.type === "buy") {
      shares = shares.plus(tx.quantity);
    } else if (tx.type === "sell") {
      shares = shares.minus(tx.quantity);
    } else if (tx.type === "split") {
      shares = shares.times(tx.quantity);
    }
    timeline.push({ date: tx.tradeDate, sharesAfter: shares });
  }

  return timeline;
}

/**
 * Find how many shares were held on a given date using the timeline.
 * Uses the last timeline entry whose date is <= the query date.
 */
export function sharesHeldOn(
  timeline: { date: Date; sharesAfter: Decimal }[],
  onDate: Date,
): Decimal {
  let held = new Decimal(0);
  for (const entry of timeline) {
    if (entry.date <= onDate) {
      held = entry.sharesAfter;
    } else {
      break;
    }
  }
  return held;
}

export function computeRetroactiveIncome(
  transactions: PositionTransaction[],
  dividendHistory: DividendHistoryRow[],
): RetroactiveIncomeRow[] {
  if (transactions.length === 0 || dividendHistory.length === 0) return [];

  const bySymbol = new Map<string, PositionTransaction[]>();
  for (const tx of transactions) {
    const list = bySymbol.get(tx.symbol) ?? [];
    list.push(tx);
    bySymbol.set(tx.symbol, list);
  }

  const result: RetroactiveIncomeRow[] = [];

  for (const d of dividendHistory) {
    const txs = bySymbol.get(d.symbol);
    if (!txs) continue;

    const timeline = buildSharesTimeline(txs);
    const exDate = new Date(`${d.exDate}T00:00:00Z`);
    const held = sharesHeldOn(timeline, exDate);

    if (held.greaterThan(0)) {
      const amount = new Decimal(d.amountPerShare);
      const income = amount.times(held);
      result.push({
        symbol: d.symbol,
        exDate: d.exDate,
        paymentDate: d.paymentDate ?? null,
        paymentDateEstimated: d.paymentDateEstimated ?? false,
        amountPerShare: d.amountPerShare,
        sharesHeld: held.toFixed(),
        income: income.toFixed(),
        currency: d.currency,
      });
    }
  }

  return result;
}

export interface AnnouncedDividendInput {
  exDate: string;
  paymentDate: string | null;
  paymentDateEstimated: boolean;
  amountPerShare: string;
  currency: string;
}

export interface ProjectedDividendRow {
  symbol: string;
  kind: "announced" | "projected";
  confidence: "high" | "low";
  exDate: string;
  paymentDate: string | null;
  paymentDateEstimated: boolean;
  amountPerShare: string;
  shares: string;
  income: string;
  currency: string;
}

const DEFAULT_PAYMENT_LAG_DAYS = 21;
const ANNOUNCED_COLLISION_DAYS = 14;

function isoAddDays(dateStr: string, days: number): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function medianPaymentLag(history: DividendHistoryRow[]): number {
  const lags = history
    .filter((r) => r.paymentDate && !r.paymentDateEstimated)
    .map((r) => daysBetween(r.exDate, r.paymentDate!))
    .filter((lag) => lag >= 0)
    .sort((a, b) => a - b);
  return lags.length > 0 ? lags[Math.floor(lags.length / 2)]! : DEFAULT_PAYMENT_LAG_DAYS;
}

/**
 * Announced-first, frequency-aware dividend projection.
 *
 * Provider-declared future dividends (`announced`) map 1:1 to high-confidence
 * `kind: "announced"` rows. Beyond those, a model schedule is generated from the
 * deduped, special-cleaned `history`:
 *  - frequency comes from the latest reported `period`, falling back to spacing
 *    inference over the cleaned ex-dates;
 *  - irregular payers repeat each trailing-12-month payment forward one year
 *    (low confidence), skipping any date colliding with an announced one;
 *  - regular payers step `FREQUENCY_INTERVAL_DAYS` from the last known ex-date
 *    (history or announced) through `asOf + 12 months`, amount from
 *    `regularDividendAmount`, payment date = ex + median real ex→pay lag.
 *
 * All generated ex-dates are strictly `> asOf` and `<= asOf + 12 months`, and
 * never collide with an announced date, so nothing is double counted. Pure: no
 * `Date.now()`; `asOf` is supplied by the caller.
 */
export function projectDividendSchedule(input: {
  symbol: string;
  quantity: Decimal;
  history: DividendHistoryRow[];
  announced: AnnouncedDividendInput[];
  asOf: Date;
}): ProjectedDividendRow[] {
  const { symbol, quantity, history, announced, asOf } = input;
  const asOfIso = asOf.toISOString().slice(0, 10);
  const windowEndIso = (() => {
    const d = new Date(asOf);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const rows: ProjectedDividendRow[] = announced
    .filter((a) => a.exDate <= windowEndIso)
    .map((a) => ({
      symbol,
      kind: "announced",
      confidence: "high",
      exDate: a.exDate,
      paymentDate: a.paymentDate,
      paymentDateEstimated: a.paymentDateEstimated,
      amountPerShare: a.amountPerShare,
      shares: quantity.toFixed(),
      income: new Decimal(a.amountPerShare).times(quantity).toFixed(2),
      currency: a.currency,
    }));

  const cleaned = excludeSpecialDividends(dedupeDividends(history));
  if (cleaned.length === 0) return rows;
  const currency = cleaned[cleaned.length - 1]!.currency;
  const lag = medianPaymentLag(cleaned);

  const latestPeriod = [...cleaned].reverse().find((r) => r.period)?.period ?? null;
  const frequency =
    frequencyFromPeriod(latestPeriod) ?? inferFrequency(cleaned.map((r) => r.exDate));

  const announcedDates = announced.map((a) => a.exDate);
  const collides = (exDate: string) =>
    announcedDates.some((d) => Math.abs(daysBetween(d, exDate)) < ANNOUNCED_COLLISION_DAYS);
  const pushProjected = (exDate: string, amount: Decimal, confidence: "high" | "low") => {
    rows.push({
      symbol,
      kind: "projected",
      confidence,
      exDate,
      paymentDate: isoAddDays(exDate, lag),
      paymentDateEstimated: true,
      amountPerShare: amount.toFixed(),
      shares: quantity.toFixed(),
      income: amount.times(quantity).toFixed(2),
      currency,
    });
  };

  if (frequency === "irregular") {
    // Repeat-last-year fallback: shift each trailing-12M payment forward a year.
    const cutoff = isoAddDays(asOfIso, -365);
    for (const r of cleaned) {
      if (r.exDate <= cutoff || r.exDate > asOfIso) continue;
      const nextEx = (() => {
        const d = new Date(`${r.exDate}T00:00:00Z`);
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        return d.toISOString().slice(0, 10);
      })();
      if (nextEx <= asOfIso || nextEx > windowEndIso || collides(nextEx)) continue;
      pushProjected(nextEx, new Decimal(r.amountPerShare), "low");
    }
    return rows.sort((a, b) => a.exDate.localeCompare(b.exDate));
  }

  const regular = regularDividendAmount(cleaned, frequency, asOf);
  if (!regular) return rows.sort((a, b) => a.exDate.localeCompare(b.exDate));

  const interval = FREQUENCY_INTERVAL_DAYS[frequency];
  const inWindowAnnouncedDates = announcedDates.filter((d) => d <= windowEndIso);
  const known = [cleaned[cleaned.length - 1]!.exDate, ...inWindowAnnouncedDates].sort();
  const lastKnown = known[known.length - 1]!;

  let next = isoAddDays(lastKnown, interval);
  while (next <= windowEndIso) {
    if (next > asOfIso && !collides(next)) {
      pushProjected(next, regular.amount, regular.confidence);
    }
    next = isoAddDays(next, interval);
  }
  return rows.sort((a, b) => a.exDate.localeCompare(b.exDate));
}

export type DividendFrequency = "monthly" | "quarterly" | "semiannual" | "annual" | "irregular";

export const FREQUENCY_INTERVAL_DAYS: Record<Exclude<DividendFrequency, "irregular">, number> = {
  monthly: 30,
  quarterly: 91,
  semiannual: 182,
  annual: 365,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default spacing below which two ex-dates are treated as the same payment.
 *  12 days comfortably covers observed cross-provider disagreement — a real
 *  Stockholm-listed monthly payer had one payment reported 8 days apart, once
 *  in EUR and once in SEK — while staying well under the tightest real payment
 *  cadence (~28 days for a monthly payer), so genuinely distinct payments are
 *  never merged. */
const SAME_PAYMENT_GAP_DAYS = 12;

/**
 * Collapse dividend rows that represent the same payment reported by different
 * providers with slightly different ex-dates (and sometimes slightly different
 * adjusted amounts). Within each symbol, rows whose ex-dates are fewer than
 * `minGapDays` apart are treated as one event and the latest-dated row is kept.
 *
 * This is necessary because the providers disagree on the exact ex-date of a
 * payment, so the `(symbol, ex_date)` key cannot dedupe them at ingestion and
 * an annual payer would otherwise be counted twice in a trailing-12-month sum.
 *
 * Output is sorted by symbol, then ex-date ascending. Input order independent.
 */
export function dedupeDividends(
  rows: DividendHistoryRow[],
  minGapDays = SAME_PAYMENT_GAP_DAYS,
): DividendHistoryRow[] {
  const gapMs = minGapDays * DAY_MS;
  const bySymbol = new Map<string, DividendHistoryRow[]>();
  for (const r of rows) {
    const list = bySymbol.get(r.symbol) ?? [];
    list.push(r);
    bySymbol.set(r.symbol, list);
  }

  const result: DividendHistoryRow[] = [];
  for (const [, list] of bySymbol) {
    const sorted = [...list].sort((a, b) => a.exDate.localeCompare(b.exDate));
    let kept: DividendHistoryRow | null = null;
    let keptTime = -Infinity;
    for (const r of sorted) {
      const time = new Date(`${r.exDate}T00:00:00Z`).getTime();
      if (kept !== null && time - keptTime < gapMs) {
        // Same payment as the previous row: prefer the later report.
        kept = r;
      } else {
        if (kept !== null) result.push(kept);
        kept = r;
      }
      keptTime = time;
    }
    if (kept !== null) result.push(kept);
  }

  return result.sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.exDate.localeCompare(b.exDate),
  );
}

/**
 * Trailing-twelve-month yield on cost: the sum of per-share dividends with an
 * ex-date in `(asOfDate - 1 year, asOfDate]`, divided by `averageCost`.
 *
 * Currency-correct by construction: a dividend is only added when its currency
 * matches `averageCost.currency`, or when `convert` reconciles it to that
 * currency. If any in-window dividend cannot be reconciled, the result is
 * `null` — a wrong number is worse than a missing one. Returns `null` when the
 * cost is zero or no dividend qualifies.
 *
 * Near-duplicate payments (the same dividend reported by multiple providers a
 * few days apart) are collapsed via {@link dedupeDividends} so they count once.
 *
 * Returns a fraction (e.g. `0.02` for a 2% yield), not a percentage.
 */
export function computeYieldOnCost(
  dividends: DividendHistoryRow[],
  averageCost: Money,
  asOfDate: Date,
  convert?: (amount: Decimal, from: string, to: string) => Decimal | null,
): Decimal | null {
  if (averageCost.isZero()) return null;

  const target = averageCost.currency;
  const lowerBound = new Date(asOfDate);
  lowerBound.setUTCFullYear(lowerBound.getUTCFullYear() - 1);

  const inWindow = dividends.filter((d) => {
    const exDate = new Date(`${d.exDate}T00:00:00Z`);
    return exDate > lowerBound && exDate <= asOfDate;
  });

  let annual = new Decimal(0);
  let qualifying = 0;

  for (const d of dedupeDividends(inWindow)) {
    const amount = new Decimal(d.amountPerShare);
    let inTarget: Decimal | null;
    if (d.currency === target) {
      inTarget = amount;
    } else if (convert) {
      inTarget = convert(amount, d.currency, target);
    } else {
      inTarget = null;
    }
    if (inTarget === null) return null;

    annual = annual.plus(inTarget);
    qualifying += 1;
  }

  if (qualifying === 0) return null;

  return annual.dividedBy(averageCost.toDecimal());
}

export function computeDividendCAGR(
  dividendHistory: DividendHistoryRow[],
  years: number,
  asOfDate: Date,
): Decimal | null {
  if (dividendHistory.length === 0 || years < 1) return null;

  const cutoff = new Date(asOfDate);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);

  // Special (one-off) distributions would otherwise inflate a bucket's count
  // and defeat the "current cadence" match below.
  const cleaned = excludeSpecialDividends(dividendHistory);

  const relevant = cleaned
    .filter((d) => {
      const date = new Date(`${d.exDate}T00:00:00Z`);
      return date > cutoff && date <= asOfDate;
    })
    .sort((a, b) => a.exDate.localeCompare(b.exDate));

  if (relevant.length === 0) return null;

  // Currency-correct by construction, like computeYieldOnCost: a payer whose
  // reporting currency changed within the window (redenomination, or a
  // provider-disagreement duplicate wider than dedupeDividends' window)
  // cannot be summed as if the face values shared a unit. A wrong number is
  // worse than a missing one.
  const canonicalCurrency = relevant[relevant.length - 1]!.currency;
  if (relevant.some((d) => d.currency !== canonicalCurrency)) return null;

  // Group dividends into 12-month periods working backwards from asOfDate
  const annualData: Array<{ total: Decimal; count: number }> = [];
  for (let y = 0; y < years; y++) {
    const periodEnd = new Date(asOfDate);
    periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() - y);
    const periodStart = new Date(asOfDate);
    periodStart.setUTCFullYear(periodStart.getUTCFullYear() - y - 1);

    const inPeriod = relevant.filter((d) => {
      const date = new Date(`${d.exDate}T00:00:00Z`);
      return date > periodStart && date <= periodEnd;
    });

    if (inPeriod.length > 0) {
      const total = inPeriod.reduce(
        (sum, d) => sum.plus(new Decimal(d.amountPerShare)),
        new Decimal(0),
      );
      annualData.push({ total, count: inPeriod.length });
    }
  }

  // Need at least 2 annual periods to compute growth
  if (annualData.length < 2) return null;

  // "Complete" periods are those matching the payer's CURRENT payout cadence
  // — inferred from the shape of its most recent payments (gap spacing, or
  // the provider's own `period` field when present), not from any single
  // bucket's raw count. A raw-count anchor is fragile two ways: an older
  // cadence with more years of history can outvote a real recent change
  // (mode), and a bucket can look short for no reason but calendar
  // boundaries even when the cadence hasn't changed at all (asOfDate lands
  // mid-cycle relative to the last real payment). Inferring cadence from
  // gaps is immune to both: it doesn't care which bucket a payment landed
  // in, only how far apart real payments actually are.
  const recentTail = relevant.slice(-8);
  const latestPeriod = [...recentTail].reverse().find((r) => r.period)?.period ?? null;
  const recentFrequency =
    frequencyFromPeriod(latestPeriod) ?? inferFrequency(recentTail.map((r) => r.exDate));

  let completeCount: number;
  if (recentFrequency === "irregular") {
    // No reliable cadence signal (too few recent payments, or genuinely
    // erratic spacing) — fall back to the previous mode-across-the-window
    // heuristic.
    const counts = annualData.map((d) => d.count);
    const countFreq = new Map<number, number>();
    for (const count of counts) {
      countFreq.set(count, (countFreq.get(count) ?? 0) + 1);
    }
    completeCount = counts[0]!;
    let maxFreq = 0;
    for (const [count, freq] of countFreq) {
      if (freq > maxFreq) {
        maxFreq = freq;
        completeCount = count;
      }
    }
  } else {
    completeCount = Math.round(365 / FREQUENCY_INTERVAL_DAYS[recentFrequency]);
  }

  // Find the latest complete period (first from start with completeCount)
  let latestCompleteIdx = -1;
  for (let i = 0; i < annualData.length; i++) {
    if (annualData[i]!.count === completeCount) {
      latestCompleteIdx = i;
      break;
    }
  }

  // Find the earliest complete period (first from end with completeCount)
  let earliestCompleteIdx = -1;
  for (let i = annualData.length - 1; i >= 0; i--) {
    if (annualData[i]!.count === completeCount) {
      earliestCompleteIdx = i;
      break;
    }
  }

  // Need at least 2 complete periods
  if (
    latestCompleteIdx === -1 ||
    earliestCompleteIdx === -1 ||
    latestCompleteIdx === earliestCompleteIdx
  ) {
    return null;
  }

  const earliest = annualData[earliestCompleteIdx]!.total;
  const latest = annualData[latestCompleteIdx]!.total;

  if (earliest.isZero()) return null;

  // CAGR = (latest / earliest) ^ (1 / (periods - 1)) - 1
  const periodsSpanned = earliestCompleteIdx - latestCompleteIdx;
  if (periodsSpanned < 1) return null;

  const ratio = latest.dividedBy(earliest);
  const exponent = new Decimal(1).dividedBy(new Decimal(periodsSpanned));
  const cagr = ratio.pow(exponent).minus(1);

  return cagr;
}

export type DividendTrend = "climbing" | "flat" | "cutting" | "unknown";

/**
 * Classify a dividend CAGR into a directional trend for at-a-glance display.
 * ±2% dead-band keeps near-flat payers from flickering between up/down.
 */
export function classifyDividendTrend(cagr: Decimal | null): DividendTrend {
  if (cagr === null) return "unknown";
  if (cagr.greaterThanOrEqualTo("0.02")) return "climbing";
  if (cagr.lessThanOrEqualTo("-0.02")) return "cutting";
  return "flat";
}

/**
 * Floors a dividend-growth figure at 0% when the caller doesn't want
 * decliners to pull a weighted aggregate negative — the `allowNegativeDividendGrowth`
 * user setting. Positive and zero values pass through unchanged either way.
 */
export function clampDividendGrowth(cagr: Decimal, allowNegative: boolean): Decimal {
  if (allowNegative) return cagr;
  return cagr.lessThan(0) ? new Decimal(0) : cagr;
}

/** Map a provider-reported cadence string (EODHD `period`) to a frequency. */
export function frequencyFromPeriod(period: string | null | undefined): DividendFrequency | null {
  if (!period) return null;
  const p = period.toLowerCase();
  if (p.includes("month")) return "monthly";
  if (p.includes("quarter")) return "quarterly";
  if (p.includes("semi")) return "semiannual";
  if (p.includes("annual") || p.includes("year")) return "annual";
  return null;
}

function daysBetween(a: string, b: string): number {
  return (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY_MS;
}

/**
 * Infer payout cadence from ex-date spacing: the median gap must sit within
 * 20% of a known interval and at least 75% of gaps must sit within 35% of the
 * median, otherwise the payer is irregular.
 */
export function inferFrequency(exDates: string[]): DividendFrequency {
  if (exDates.length < 3) return "irregular";
  const sorted = [...exDates].sort();
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1]!, sorted[i]!));
  const byLength = [...gaps].sort((a, b) => a - b);
  const median = byLength[Math.floor(byLength.length / 2)]!;

  const consistent = gaps.filter((g) => Math.abs(g - median) <= median * 0.35).length;
  if (consistent < gaps.length * 0.75) return "irregular";

  for (const [freq, days] of Object.entries(FREQUENCY_INTERVAL_DAYS) as [
    Exclude<DividendFrequency, "irregular">,
    number,
  ][]) {
    if (Math.abs(median - days) <= days * 0.2) return freq;
  }
  return "irregular";
}

/**
 * Drop special (one-off) distributions: a payment counts as special when its
 * amount is more than twice the median amount AND it sits off-schedule —
 * closer to a neighbouring payment than half the typical gap.
 */
export function excludeSpecialDividends(rows: DividendHistoryRow[]): DividendHistoryRow[] {
  if (rows.length < 4) return rows;
  const sorted = [...rows].sort((a, b) => a.exDate.localeCompare(b.exDate));
  const amounts = sorted.map((r) => new Decimal(r.amountPerShare)).sort((a, b) => a.comparedTo(b));
  const medianAmount = amounts[Math.floor(amounts.length / 2)]!;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(daysBetween(sorted[i - 1]!.exDate, sorted[i]!.exDate));
  }
  const gapsSorted = [...gaps].sort((a, b) => a - b);
  const medianGap = gapsSorted[Math.floor(gapsSorted.length / 2)]!;

  return sorted.filter((r, i) => {
    if (new Decimal(r.amountPerShare).lessThanOrEqualTo(medianAmount.times(2))) return true;
    const prevGap = i > 0 ? daysBetween(sorted[i - 1]!.exDate, r.exDate) : Infinity;
    const nextGap = i < sorted.length - 1 ? daysBetween(r.exDate, sorted[i + 1]!.exDate) : Infinity;
    const offSchedule = Math.min(prevGap, nextGap) < medianGap * 0.5;
    return !offSchedule;
  });
}

const VARIABLE_PAYER_CV = 0.25;

/** The per-payment amount to project forward, with a confidence grade. */
export function regularDividendAmount(
  rows: DividendHistoryRow[],
  frequency: DividendFrequency,
  asOf: Date,
): { amount: Decimal; confidence: "high" | "low" } | null {
  const cutoff = new Date(asOf);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const asOfIso = asOf.toISOString().slice(0, 10);
  const sorted = [...rows].sort((a, b) => a.exDate.localeCompare(b.exDate));
  const trailing = sorted.filter((r) => r.exDate > cutoffIso && r.exDate <= asOfIso);
  if (trailing.length === 0) return null;

  const values = trailing.map((r) => new Decimal(r.amountPerShare));
  const mean = values.reduce((s, v) => s.plus(v), new Decimal(0)).dividedBy(values.length);
  if (values.length >= 3 && !mean.isZero()) {
    const variance = values
      .reduce((s, v) => s.plus(v.minus(mean).pow(2)), new Decimal(0))
      .dividedBy(values.length);
    const cv = variance.sqrt().dividedBy(mean);
    if (cv.greaterThan(VARIABLE_PAYER_CV)) return { amount: mean, confidence: "low" };
  }

  if (frequency === "monthly" || frequency === "quarterly") {
    const lastThree = sorted.slice(-3).map((r) => new Decimal(r.amountPerShare));
    const mid = [...lastThree].sort((a, b) => a.comparedTo(b))[Math.floor(lastThree.length / 2)]!;
    return { amount: mid, confidence: "high" };
  }
  return { amount: new Decimal(sorted[sorted.length - 1]!.amountPerShare), confidence: "high" };
}
