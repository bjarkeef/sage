import type { DividendPerHoldingDTO, PositionDTO } from "./types";

export interface PortfolioYields {
  /** Trailing annual dividends ÷ total cost basis, as a percentage (null if no cost). */
  yieldOnCost: number | null;
  /** Trailing annual dividends ÷ total market value, as a percentage (null if unpriced). */
  dividendYield: number | null;
}

/**
 * Portfolio-level **trailing** dividend yields (gross / before tax).
 *
 * Both denominators span the WHOLE portfolio — including holdings that pay no
 * dividend — so the yield isn't overstated by measuring income against only the
 * income-paying slice. The annual-dividend numerator is reconstructed per
 * position from its yield-on-cost × cost basis (a position only contributes
 * income when it has a trailing / contractual yield).
 *
 * Currency-safe: every cost-basis (and market-value) currency across positions
 * must agree. Mixed books without a display-currency conversion return null
 * rather than summing EUR+USD face values — same honesty contract as
 * {@link computeGrossForwardYield}.
 */
export function computePortfolioYields(positions: PositionDTO[]): PortfolioYields {
  let annualDividend = 0;
  let costBasis = 0;
  let marketValue = 0;
  const costCurrencies = new Set<string>();
  const mvCurrencies = new Set<string>();

  for (const p of positions) {
    costCurrencies.add(p.costBasis.currency);
    costBasis += Number(p.costBasis.amount);
    if (p.marketValue) {
      mvCurrencies.add(p.marketValue.currency);
      marketValue += Number(p.marketValue.amount);
    }
    if (p.yieldOnCost != null) {
      // YoC is a unitless fraction from native-currency math; × converted cost
      // basis reconstructs annual income in the same units as costBasis when
      // the book is single-currency (including after display-FX conversion).
      annualDividend += p.yieldOnCost * Number(p.costBasis.amount);
    }
  }

  if (costCurrencies.size !== 1) {
    return { yieldOnCost: null, dividendYield: null };
  }

  return {
    yieldOnCost: costBasis > 0 ? (annualDividend / costBasis) * 100 : null,
    dividendYield:
      marketValue > 0 && mvCurrencies.size === 1 ? (annualDividend / marketValue) * 100 : null,
  };
}

/**
 * Gross (pre-tax) forward portfolio yield: Σ forwardAnnualIncome ÷ Σ marketValue,
 * over holdings with `marketValue > 0` — the same gate every per-row forward
 * yield uses. Currency-safe by construction: a row only contributes if its
 * forward-income currency and market-value currency agree, AND the running
 * set of currencies across all contributing rows stays a single currency.
 * Any mixed-currency situation (no display currency set, holdings priced in
 * different native currencies) returns null rather than silently summing
 * incompatible amounts — see the repo's FX-mixing yield bug history.
 */
export function computeGrossForwardYield(
  perHolding: DividendPerHoldingDTO[],
  positions: PositionDTO[],
): number | null {
  const marketValueBySymbol = new Map(positions.map((p) => [p.symbol, p.marketValue]));

  let numerator = 0;
  let denominator = 0;
  const currencies = new Set<string>();

  for (const h of perHolding) {
    const marketValue = marketValueBySymbol.get(h.symbol);
    if (!marketValue) continue;
    const marketValueAmount = Number(marketValue.amount);
    if (!(marketValueAmount > 0)) continue;
    if (marketValue.currency !== h.forwardAnnualIncome.currency) continue;

    currencies.add(marketValue.currency);
    numerator += Number(h.forwardAnnualIncome.amount);
    denominator += marketValueAmount;
  }

  if (currencies.size !== 1 || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}
