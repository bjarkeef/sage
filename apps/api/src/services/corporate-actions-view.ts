import { formatSplitRatio, type BasisFinding, type PositionTransaction } from "@sage/core";

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
