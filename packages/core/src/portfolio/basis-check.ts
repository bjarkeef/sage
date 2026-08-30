import { Decimal } from "../money/decimal";

/** One transaction paired with the stored close on its own trade date, both
 *  already expressed in the same currency by the caller. */
export interface BasisSample {
  date: string;
  symbol: string;
  /** Transacted price per share, converted into the bar's currency. */
  transacted: Decimal;
  /** Stored close for that date, in its own currency. */
  close: Decimal;
}

export interface BasisFinding {
  symbol: string;
  /** Median divergence across the mismatched samples. */
  factor: Decimal;
  /** How many of this symbol's checked samples disagree. */
  mismatched: number;
  /** How many samples could be checked at all. */
  samples: number;
  /** Range covered by the MISMATCHED samples, not by all of them. */
  firstDate: string;
  lastDate: string;
}

/** Divergence at or above which a transacted price and the same day's close are
 *  no longer explicable as market movement.
 *
 *  1.5 sits in a gap. Below it: a fill differs from the close by a few percent,
 *  and even a violent intraday swing stays well under 50%. Above it: the
 *  smallest split that could distort anything is 2:1. An earlier draft proposed
 *  5x, which would have missed every 2:1 and 3:1 split — the most common kinds.
 *
 *  Sage is self-hosted, so anyone who disagrees should be able to find this and
 *  change it; that is why it is a named constant rather than an inline literal. */
export const BASIS_MISMATCH_RATIO = 1.5;

/** Middle value; the mean of the two middles for an even count. Median rather
 *  than mean so a single extreme sample cannot drag the reported factor away
 *  from the real ratio. */
function median(values: Decimal[]): Decimal {
  const sorted = [...values].sort((a, b) => (a.lessThan(b) ? -1 : a.greaterThan(b) ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return sorted[mid - 1]!.plus(sorted[mid]!).dividedBy(2);
}

/**
 * Per-symbol findings where transacted prices and stored closes disagree by
 * more than market movement can explain.
 *
 * Detects only THAT the bases differ, never why: a split, a minor-unit
 * confusion (GBX against GBP) and an ADR ratio change all look the same here,
 * and naming the cause needs evidence this function does not have.
 *
 * A symbol whose samples all agree produces no finding at all — not a finding
 * with `mismatched: 0` — so a caller can treat presence as the signal.
 *
 * Samples with a non-positive price or close are skipped and do not count
 * towards `samples`: a zero makes the ratio undefined rather than large, and an
 * unchecked sample must never read as a checked one.
 */
export function detectBasisMismatches(samples: BasisSample[]): BasisFinding[] {
  const bySymbol = new Map<string, BasisSample[]>();
  for (const s of samples) {
    if (s.transacted.lessThanOrEqualTo(0) || s.close.lessThanOrEqualTo(0)) continue;
    const list = bySymbol.get(s.symbol) ?? [];
    list.push(s);
    bySymbol.set(s.symbol, list);
  }

  const findings: BasisFinding[] = [];
  for (const [symbol, list] of bySymbol) {
    const bad: { date: string; ratio: Decimal }[] = [];
    for (const s of list) {
      const larger = s.transacted.greaterThan(s.close) ? s.transacted : s.close;
      const smaller = s.transacted.greaterThan(s.close) ? s.close : s.transacted;
      const ratio = larger.dividedBy(smaller);
      if (ratio.greaterThanOrEqualTo(BASIS_MISMATCH_RATIO)) bad.push({ date: s.date, ratio });
    }
    if (bad.length === 0) continue;
    const dates = bad.map((b) => b.date).sort();
    findings.push({
      symbol,
      factor: median(bad.map((b) => b.ratio)),
      mismatched: bad.length,
      samples: list.length,
      firstDate: dates[0]!,
      lastDate: dates[dates.length - 1]!,
    });
  }
  findings.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  return findings;
}
