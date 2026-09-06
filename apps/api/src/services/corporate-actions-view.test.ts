import { describe, it, expect } from "vitest";
import { Decimal, Money } from "@sage/core";
import { buildCorporateActionsView } from "./corporate-actions-view";

const tx = (symbol: string, date: string, quantity: string, type = "split") => ({
  symbol,
  type: type as "split" | "buy",
  quantity: new Decimal(quantity),
  price: Money.zero("EUR"),
  tradeDate: new Date(`${date}T00:00:00Z`),
});

describe("buildCorporateActionsView", () => {
  it("reports an adjusted action with the factor and the samples behind it", () => {
    const view = buildCorporateActionsView({
      txs: [tx("ACME", "2025-11-30", "0.1")],
      names: new Map([["ACME", "Acme Ultra Income ETF"]]),
      pricesFrom: new Map([["ACME", "2024-02-29"]]),
      findings: [
        {
          symbol: "ACME",
          factor: new Decimal("10.06"),
          mismatched: 2,
          samples: 2,
          firstDate: "2025-10-27",
          lastDate: "2025-11-07",
        },
      ],
      verdictOf: () => "adjusted",
      coverage: { checked: 216, total: 289 },
    });

    expect(view.actions).toHaveLength(1);
    expect(view.actions[0]).toMatchObject({
      symbol: "ACME",
      name: "Acme Ultra Income ETF",
      date: "2025-11-30",
      ratio: "10 → 1",
      kind: "reverse-split",
      verdict: "adjusted",
      detectedFactor: 10.06,
      mismatchedSamples: 2,
      checkedSamples: 2,
      pricesFrom: "2024-02-29",
    });
    expect(view.coverage).toEqual({ checked: 216, total: 289 });
  });

  it("reports an unadjusted action with no factor, because none was found", () => {
    const view = buildCorporateActionsView({
      txs: [tx("THAMES.L", "2025-09-16", "1.34290551")],
      names: new Map(),
      pricesFrom: new Map([["THAMES.L", "2023-03-02"]]),
      findings: [],
      verdictOf: () => "unadjusted",
      coverage: { checked: 216, total: 289 },
    });

    expect(view.actions[0]).toMatchObject({
      symbol: "THAMES.L",
      name: null,
      ratio: "1 → 1.7992",
      kind: "split",
      verdict: "unadjusted",
      detectedFactor: null,
      mismatchedSamples: null,
      checkedSamples: null,
    });
  });

  // The boundary date is what the unverified copy names, so it must survive
  // even when nothing else about the symbol is known.
  it("carries pricesFrom for an unverified action", () => {
    const view = buildCorporateActionsView({
      txs: [tx("ACME", "2025-09-16", "2")],
      names: new Map(),
      pricesFrom: new Map([["ACME", "2025-09-05"]]),
      findings: [],
      verdictOf: () => "unverified",
      coverage: { checked: 0, total: 289 },
    });
    expect(view.actions[0]).toMatchObject({ verdict: "unverified", pricesFrom: "2025-09-05" });
  });

  it("ignores every transaction that is not a split", () => {
    const view = buildCorporateActionsView({
      txs: [tx("ACME", "2025-01-02", "10", "buy")],
      names: new Map(),
      pricesFrom: new Map(),
      findings: [],
      verdictOf: () => "unadjusted",
      coverage: { checked: 0, total: 0 },
    });
    expect(view.actions).toEqual([]);
  });

  it("sorts newest first, the way a log is read", () => {
    const view = buildCorporateActionsView({
      txs: [tx("ACME", "2024-01-05", "2"), tx("THAMES.L", "2025-09-16", "2")],
      names: new Map(),
      pricesFrom: new Map(),
      findings: [],
      verdictOf: () => "unadjusted",
      coverage: { checked: 1, total: 1 },
    });
    expect(view.actions.map((a) => a.date)).toEqual(["2025-09-16", "2024-01-05"]);
  });

  // A ratio of zero or less cannot describe a real corporate action and would
  // send a multiplier to zero. split-basis.ts already refuses these; the view
  // must not display what the maths refuses to use.
  it("drops a non-positive ratio rather than rendering nonsense", () => {
    const view = buildCorporateActionsView({
      txs: [tx("ACME", "2025-01-02", "0")],
      names: new Map(),
      pricesFrom: new Map(),
      findings: [],
      verdictOf: () => "unadjusted",
      coverage: { checked: 0, total: 0 },
    });
    expect(view.actions).toEqual([]);
  });

  // This page reports what the valuation layer did; it must never become a
  // second thing that decides. A pure derivation is what keeps the three
  // surfaces agreeing, so the builder is asserted to touch nothing and to
  // return the same answer for the same input.
  it("is a pure derivation: same input, same output, inputs unmutated", () => {
    const txs = [tx("ACME", "2025-11-30", "0.1")];
    const input = {
      txs,
      names: new Map([["ACME", "Acme Ultra Income ETF"]]),
      pricesFrom: new Map([["ACME", "2024-02-29"]]),
      findings: [],
      verdictOf: () => "unadjusted" as const,
      coverage: { checked: 1, total: 1 },
    };
    const before = JSON.stringify(txs.map((t) => ({ ...t, quantity: t.quantity.toString() })));

    const first = buildCorporateActionsView(input);
    const second = buildCorporateActionsView(input);

    expect(second).toEqual(first);
    expect(JSON.stringify(txs.map((t) => ({ ...t, quantity: t.quantity.toString() })))).toBe(
      before,
    );
  });
});
