import { describe, it, expect } from "vitest";
import type { ConstituentDTO, DiversificationDimRowDTO, MoneyDTO } from "./types";
import {
  aggregateConstituents,
  aggregateDimension,
  aggregateHoldings,
  selectSectorRows,
} from "./diversification";

const m = (amount: string): MoneyDTO => ({ amount, currency: "USD" });

function dim(
  symbol: string,
  name: string,
  bucket: string,
  market: string,
  cost: string,
  extra: Partial<DiversificationDimRowDTO> = {},
): DiversificationDimRowDTO {
  return {
    symbol,
    name,
    bucket,
    marketValue: m(market),
    costValue: m(cost),
    isFund: false,
    ...extra,
  };
}

describe("aggregateDimension", () => {
  const rows = [
    dim("AAPL", "Apple Inc", "Technology", "600.00", "100.00"),
    dim("MSFT", "Microsoft Corp", "Technology", "200.00", "100.00"),
    dim("KO", "Coca-Cola Co", "Consumer Defensive", "200.00", "200.00"),
  ];

  it("groups by bucket, sums the chosen basis, and computes percents", () => {
    const buckets = aggregateDimension(rows, "market");
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ label: "Technology", amount: 800, percent: 80 });
    expect(buckets[1]).toMatchObject({ label: "Consumer Defensive", amount: 200, percent: 20 });
  });

  it("switches to cost basis", () => {
    const buckets = aggregateDimension(rows, "cost");
    const tech = buckets.find((b) => b.label === "Technology");
    expect(tech).toMatchObject({ amount: 200, percent: 50 });
  });

  it("computes per-bucket holding percents sorted descending", () => {
    const tech = aggregateDimension(rows, "market").find((b) => b.label === "Technology")!;
    expect(tech.holdings.map((h) => h.name)).toEqual(["Apple Inc", "Microsoft Corp"]);
    expect(tech.holdings[0]!.percentOfBucket).toBe(75);
  });

  it("labels x-ray fund slices with symbol and weight", () => {
    const buckets = aggregateDimension(
      [
        dim("VOO", "Vanguard S&P 500", "Technology", "120.00", "180.00", {
          isFund: true,
          fundWeightPct: 60,
        }),
      ],
      "market",
    );
    expect(buckets[0]!.holdings[0]!.label).toBe("VOO (60.00%)");
  });

  it("returns [] for a zero total", () => {
    expect(aggregateDimension([dim("A", "A", "X", "0.00", "0.00")], "market")).toEqual([]);
  });
});

describe("selectSectorRows", () => {
  it("picks plain when x-ray is off and xray when on", () => {
    const plain = [dim("A", "A", "Funds", "1.00", "1.00")];
    const xray = [dim("A", "A", "Technology", "1.00", "1.00")];
    expect(selectSectorRows({ plain, xray }, false)).toBe(plain);
    expect(selectSectorRows({ plain, xray }, true)).toBe(xray);
  });
});

describe("aggregateHoldings", () => {
  it("returns [] for a zero total", () => {
    expect(aggregateHoldings([dim("A", "A", "USD", "0.00", "0.00")], "market")).toEqual([]);
  });

  it("makes one bucket per holding labeled by name", () => {
    const buckets = aggregateHoldings(
      [
        dim("AAPL", "Apple Inc", "USD", "800.00", "100.00"),
        dim("VOO", "Vanguard S&P 500", "USD", "200.00", "300.00"),
      ],
      "market",
    );
    expect(buckets.map((b) => b.label)).toEqual(["Apple Inc", "Vanguard S&P 500"]);
    expect(buckets[0]).toMatchObject({ amount: 800, percent: 80 });
  });
});

describe("aggregateConstituents", () => {
  const constituents: ConstituentDTO[] = [
    {
      key: "AAPL",
      symbol: "AAPL",
      name: "Apple Inc",
      marketValue: m("920.00"),
      costValue: m("280.00"),
      sources: [
        { type: "direct", marketValue: m("800.00"), costValue: m("100.00") },
        { type: "fund", fundSymbol: "VOO", marketValue: m("120.00"), costValue: m("180.00") },
      ],
    },
    {
      key: "VOO:other",
      symbol: null,
      name: "VOO — other holdings",
      marketValue: m("80.00"),
      costValue: m("120.00"),
      sources: [
        { type: "fund", fundSymbol: "VOO", marketValue: m("80.00"), costValue: m("120.00") },
      ],
    },
  ];

  it("builds one bucket per constituent with source rows labeled Direct / via FUND", () => {
    const buckets = aggregateConstituents(constituents, "market");
    expect(buckets[0]).toMatchObject({ label: "Apple Inc", amount: 920, percent: 92 });
    expect(buckets[0]!.holdings.map((h) => h.label)).toEqual(["Direct", "via VOO"]);
    expect(buckets[1]).toMatchObject({ label: "VOO — other holdings", percent: 8 });
  });

  it("respects the cost basis", () => {
    const buckets = aggregateConstituents(constituents, "cost");
    expect(buckets[1]).toMatchObject({ label: "VOO — other holdings", amount: 120, percent: 30 });
  });

  it("returns [] for a zero total", () => {
    const zero = constituents.map((c) => ({
      ...c,
      marketValue: m("0.00"),
      sources: c.sources.map((s) => ({ ...s, marketValue: m("0.00") })),
    }));
    expect(aggregateConstituents(zero, "market")).toEqual([]);
  });
});
