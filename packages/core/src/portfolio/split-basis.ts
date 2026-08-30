import { Decimal } from "../money/decimal";
import type { PositionTransaction } from "./positions";
import type { BasisFinding } from "./basis-check";

export type SplitBasisVerdict = "adjusted" | "unadjusted" | "unverified";

export interface SplitBasisResolution {
  verdictOf(symbol: string): SplitBasisVerdict;
  /** Multiplier for a raw quantity on `date`; 1 unless the symbol is adjusted. */
  factorAt(symbol: string, date: string): Decimal;
  /** Symbols carrying a split that could not be checked. */
  unverified: string[];
  /** True when the book has no usable split rows at all. Callers use it to skip
   *  work entirely rather than calling `factorAt` per symbol per date. */
  identity: boolean;
}

/** How far a detected basis factor may sit from the one a recorded split
 *  predicts and still count as explained by it.
 *
 *  0.15 has to clear two bars. It must be far wider than the noise between a
 *  fill and the same day's close — the real mismatch that motivated this landed
 *  0.8% off its expected 10x — and far narrower than the distance to any
 *  unrelated cause, so
 *  a 100x minor-unit error on a symbol that also split stays flagged instead of
 *  being absorbed as "explained".
 *
 *  Sage is self-hosted; anyone who disagrees should be able to find this and
 *  change it, which is why it is a named constant. */
export const SPLIT_FACTOR_TOLERANCE = 0.15;

const ONE = new Decimal(1);

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Decide, per symbol, whether its stored price history is on a different share
 * basis than its ledger — and by how much to scale historical quantities when
 * it is.
 *
 * The rule is arithmetic, not a heuristic. For a date `d`, `p` is the product of
 * the ratios of every split dated strictly after `d`; the correct quantity is
 * the raw quantity times `p`, and the basis mismatch phase 1 would detect is
 * `max(p, 1/p)`. When a symbol's detected factor matches that prediction within
 * {@link SPLIT_FACTOR_TOLERANCE}, the split explains the mismatch and the
 * correction is exact.
 *
 * Deliberately conservative in both directions. A split with no checkable
 * sample is reported as `unverified` rather than corrected — correcting on no
 * evidence would corrupt a genuinely unadjusted history. A mismatch the split
 * does not predict stays `unadjusted` and stays flagged, because something else
 * is wrong and this function does not know what.
 *
 * Deterministic: the valuation series and the reporting layer both call it on
 * the same inputs, which is what stops a corrected symbol from still carrying a
 * warning.
 */
export function resolveSplitBasis(
  txs: PositionTransaction[],
  findings: BasisFinding[],
  checkedBySymbol: Map<string, number>,
): SplitBasisResolution {
  // A ratio of zero or less cannot describe a real corporate action and would
  // send the multiplier to zero, wiping a holding out of its own history.
  const splitsBySymbol = new Map<string, { date: string; ratio: Decimal }[]>();
  for (const t of txs) {
    if (t.type !== "split") continue;
    if (t.quantity.lessThanOrEqualTo(0)) continue;
    const list = splitsBySymbol.get(t.symbol) ?? [];
    list.push({ date: toDateKey(t.tradeDate), ratio: t.quantity });
    splitsBySymbol.set(t.symbol, list);
  }

  if (splitsBySymbol.size === 0) {
    return {
      verdictOf: () => "unadjusted",
      factorAt: () => ONE,
      unverified: [],
      identity: true,
    };
  }

  const findingBySymbol = new Map(findings.map((f) => [f.symbol, f]));
  const verdicts = new Map<string, SplitBasisVerdict>();

  for (const [symbol, splits] of splitsBySymbol) {
    if ((checkedBySymbol.get(symbol) ?? 0) === 0) {
      verdicts.set(symbol, "unverified");
      continue;
    }
    const found = findingBySymbol.get(symbol);
    if (!found) {
      // Checked and clean: the ledger agrees with the bars, so the history is
      // on the same basis and nothing needs scaling.
      verdicts.set(symbol, "unadjusted");
      continue;
    }
    // Predict the factor from the total product; the mismatched samples all
    // predate the splits that explain them.
    const total = splits.reduce((acc, s) => acc.times(s.ratio), ONE);
    const predicted = total.greaterThan(ONE) ? total : ONE.dividedBy(total);
    const drift = found.factor.minus(predicted).abs().dividedBy(predicted);
    verdicts.set(
      symbol,
      drift.lessThanOrEqualTo(SPLIT_FACTOR_TOLERANCE) ? "adjusted" : "unadjusted",
    );
  }

  const unverified = [...verdicts.entries()]
    .filter(([, v]) => v === "unverified")
    .map(([s]) => s)
    .sort();

  return {
    verdictOf: (symbol) => verdicts.get(symbol) ?? "unadjusted",
    factorAt: (symbol, date) => {
      if (verdicts.get(symbol) !== "adjusted") return ONE;
      const splits = splitsBySymbol.get(symbol);
      if (!splits) return ONE;
      // Strictly after: `replayHoldings` applies a split ON its date, so the
      // quantity already carries that ratio from that day forward.
      return splits.filter((s) => s.date > date).reduce((acc, s) => acc.times(s.ratio), ONE);
    },
    unverified,
    identity: false,
  };
}
