import { and, eq, inArray } from "drizzle-orm";
import { Decimal, detectBasisMismatches, type BasisSample, type BasisFinding } from "@sage/core";
import type { IFxRateService } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { transaction, portfolio, priceDaily } from "../db/schema";
import { getRatesWithProvenance } from "../market-data/fx-provenance";

/** Wire shape for a finding: Decimal becomes a number, everything else passes
 *  through unchanged. */
export interface BasisFindingBody {
  symbol: string;
  factor: number;
  mismatched: number;
  samples: number;
  firstDate: string;
  lastDate: string;
}

export function toBasisFindingBody(f: BasisFinding): BasisFindingBody {
  return {
    symbol: f.symbol,
    factor: Number(f.factor.toFixed(4)),
    mismatched: f.mismatched,
    samples: f.samples,
    firstDate: f.firstDate,
    lastDate: f.lastDate,
  };
}

/**
 * Per-symbol findings where what the user paid disagrees with what the stored
 * price series says a share was worth that day.
 *
 * One indexed join rather than a price fetch: a basis mismatch is a property of
 * the book, not of the range being viewed, so this costs the same whichever
 * page asks and never widens a provider call.
 *
 * Only buys and sells are sampled. A dividend's price is per-share income, not
 * a share price, and a split carries no price at all — including either would
 * manufacture divergences.
 *
 * Corrects nothing. Every figure the caller publishes is unchanged; the point
 * is that a wrong one can now be named.
 */
export async function findBasisMismatches(
  deps: { db: Database; fxRateService?: IFxRateService },
  userId: string,
  opts?: { symbols?: string[] },
): Promise<{ findings: BasisFinding[]; checkedBySymbol: Map<string, number> }> {
  // An explicit empty filter means "nothing to check" — scanning the whole book
  // would be the opposite of what the caller asked for.
  if (opts?.symbols && opts.symbols.length === 0) {
    return { findings: [], checkedBySymbol: new Map() };
  }

  const where = [eq(portfolio.userId, userId), inArray(transaction.type, ["buy", "sell"])];
  if (opts?.symbols) where.push(inArray(transaction.instrumentSymbol, opts.symbols));

  const rows = await deps.db
    .select({
      symbol: transaction.instrumentSymbol,
      tradeDate: transaction.tradeDate,
      price: transaction.price,
      txCurrency: transaction.currency,
      close: priceDaily.close,
      barCurrency: priceDaily.currency,
    })
    .from(transaction)
    .innerJoin(portfolio, eq(portfolio.id, transaction.portfolioId))
    .innerJoin(
      priceDaily,
      and(
        eq(priceDaily.symbol, transaction.instrumentSymbol),
        eq(priceDaily.date, transaction.tradeDate),
      ),
    )
    .where(and(...where));

  if (rows.length === 0) return { findings: [], checkedBySymbol: new Map() };

  // Rates are keyed per BAR currency: `getRates(base, targets)` returns units of
  // each target per 1 base, so an amount in `txCurrency` converts into
  // `barCurrency` by DIVIDING by the rate for `txCurrency`. Same divisor
  // convention the valuation series uses.
  const ratesByBar = new Map<string, Map<string, Decimal>>();
  if (deps.fxRateService) {
    const pairs = new Map<string, Set<string>>();
    for (const r of rows) {
      if (r.txCurrency === r.barCurrency) continue;
      const set = pairs.get(r.barCurrency) ?? new Set<string>();
      set.add(r.txCurrency);
      pairs.set(r.barCurrency, set);
    }
    for (const [bar, sources] of pairs) {
      const { rates } = await getRatesWithProvenance(deps.fxRateService, bar, [...sources]);
      ratesByBar.set(bar, rates);
    }
  }

  const samples: BasisSample[] = [];
  for (const r of rows) {
    let transacted = new Decimal(r.price);
    if (r.txCurrency !== r.barCurrency) {
      const divisor = ratesByBar.get(r.barCurrency)?.get(r.txCurrency);
      // No rate for this pair: the sample is UNCHECKED. Dropping it keeps a
      // currency gap from masquerading as a basis mismatch, at the cost of
      // silence — which is the honest trade in that direction.
      if (!divisor || divisor.isZero()) continue;
      transacted = transacted.dividedBy(divisor);
    }
    samples.push({
      date: r.tradeDate,
      symbol: r.symbol,
      transacted,
      close: new Decimal(r.close),
    });
  }

  // Counted from the samples that survived, so an unconvertible currency or a
  // zero price leaves a symbol UNCHECKED rather than checked-and-clean. The
  // distinction is what the split-basis `unverified` verdict rests on.
  const checkedBySymbol = new Map<string, number>();
  for (const s of samples) {
    checkedBySymbol.set(s.symbol, (checkedBySymbol.get(s.symbol) ?? 0) + 1);
  }

  return { findings: detectBasisMismatches(samples), checkedBySymbol };
}
