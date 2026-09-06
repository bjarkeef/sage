import { inArray, sql } from "drizzle-orm";
import {
  formatSplitRatio,
  resolveSplitBasis,
  type BasisFinding,
  type PositionTransaction,
} from "@sage/core";
import type { IFxRateService } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { instrument, priceDaily } from "../db/schema";
import { findBasisMismatches } from "./basis-reconciliation";
import { loadPortfolioBook } from "./portfolio-book";

export interface CorporateActionDTO {
  symbol: string;
  name: string | null;
  date: string;
  ratio: string;
  kind: "split" | "reverse-split";
  verdict: "adjusted" | "unadjusted" | "unverified";
  detectedFactor: number | null;
  mismatchedSamples: number | null;
  checkedSamples: number | null;
  pricesFrom: string | null;
}

export interface CorporateActionsViewDTO {
  actions: CorporateActionDTO[];
  /** The denominator. A verdict list without it invites false confidence. */
  coverage: { checked: number; total: number };
}

export interface CorporateActionsInput {
  txs: PositionTransaction[];
  names: Map<string, string>;
  /** Earliest stored bar per symbol — names the boundary in `unverified` copy. */
  pricesFrom: Map<string, string>;
  findings: BasisFinding[];
  verdictOf: (symbol: string) => "adjusted" | "unadjusted" | "unverified";
  coverage: { checked: number; total: number };
}

export function buildCorporateActionsView(input: CorporateActionsInput): CorporateActionsViewDTO {
  const findingBySymbol = new Map(input.findings.map((f) => [f.symbol, f]));

  const actions = input.txs
    .filter((t) => t.type === "split" && t.quantity.greaterThan(0))
    .map((t): CorporateActionDTO => {
      const { ratio, kind } = formatSplitRatio(t.quantity);
      const finding = findingBySymbol.get(t.symbol) ?? null;
      return {
        symbol: t.symbol,
        name: input.names.get(t.symbol) ?? null,
        date: t.tradeDate.toISOString().slice(0, 10),
        ratio,
        kind,
        verdict: input.verdictOf(t.symbol),
        detectedFactor: finding ? Number(finding.factor.toFixed(4)) : null,
        mismatchedSamples: finding ? finding.mismatched : null,
        checkedSamples: finding ? finding.samples : null,
        pricesFrom: input.pricesFrom.get(t.symbol) ?? null,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { actions, coverage: input.coverage };
}

/**
 * Wires the pure builder above to the live book. Reads only — the ledger is
 * never touched, historical quantities are scaled at valuation time, and this
 * loader reports that, it does not perform it.
 */
export async function loadCorporateActions(
  deps: { db: Database; fxRateService?: IFxRateService },
  userId: string,
): Promise<CorporateActionsViewDTO> {
  const { txs } = await loadPortfolioBook(deps.db, userId, {});

  // The same functions /performance and /portfolio call, on the same book:
  // agreement between the three surfaces comes from the function, not from a
  // shared cache.
  const { findings, checkedBySymbol } = await findBasisMismatches(
    { db: deps.db, fxRateService: deps.fxRateService },
    userId,
  );
  const splitBasis = resolveSplitBasis(txs, findings, checkedBySymbol);

  const splitSymbols = [...new Set(txs.filter((t) => t.type === "split").map((t) => t.symbol))];

  const names = new Map<string, string>();
  const pricesFrom = new Map<string, string>();
  if (splitSymbols.length > 0) {
    for (const row of await deps.db
      .select({ symbol: instrument.symbol, name: instrument.name })
      .from(instrument)
      .where(inArray(instrument.symbol, splitSymbols))) {
      if (row.name) names.set(row.symbol, row.name);
    }
    for (const row of await deps.db
      .select({ symbol: priceDaily.symbol, earliest: sql<string | null>`min(${priceDaily.date})` })
      .from(priceDaily)
      .where(inArray(priceDaily.symbol, splitSymbols))
      .groupBy(priceDaily.symbol)) {
      if (row.earliest) pricesFrom.set(row.symbol, row.earliest);
    }
  }

  // Coverage is the honest denominator: how many of the book's buys and sells
  // could be compared against a stored bar at all.
  const total = txs.filter((t) => t.type === "buy" || t.type === "sell").length;
  const checked = [...checkedBySymbol.values()].reduce((a, b) => a + b, 0);

  return buildCorporateActionsView({
    txs,
    names,
    pricesFrom,
    findings,
    verdictOf: (s) => splitBasis.verdictOf(s),
    coverage: { checked, total },
  });
}
