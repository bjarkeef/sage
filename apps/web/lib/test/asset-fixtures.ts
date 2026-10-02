import type {
  AnalystRatingsDTO,
  AssetDetailDTO,
  AssetUpcomingDTO,
  MoneyDTO,
  PositionDTO,
} from "../types";

/**
 * Invented fixtures for the asset-page tests. Nothing here comes from a real
 * book: the ticker is a universal placeholder or on the ALLOWED list, the name
 * and every amount are made up.
 *
 * TODAY is injected: components take it as `todayISO`, and every date below is
 * built from it with `day()`. Nothing compares it with the real clock.
 */
export const TODAY = "2026-06-15";

export function day(offset: number, from: string = TODAY): string {
  return new Date(Date.parse(`${from}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

export const usd = (amount: string): MoneyDTO => ({ amount, currency: "USD" });

export function upcomingRow(
  offset: number,
  over: Partial<AssetUpcomingDTO> = {},
): AssetUpcomingDTO {
  return {
    exDate: day(offset),
    paymentDate: day(offset + 14),
    amountPerShare: "0.50",
    currency: "USD",
    certainty: "estimated",
    window: "next12m",
    ...over,
  };
}

/** Four quarterly payments of 0.50 in the last year, newest first (the DTO's order). */
export function quarterlyHistory(): AssetDetailDTO["dividends"]["history"] {
  return [-30, -121, -212, -303].map((o) => ({
    exDate: day(o),
    amountPerShare: "0.50",
    currency: "USD",
    paymentDate: day(o + 14),
  }));
}

/** A held quarterly payer: 100 shares bought at 40, quoted at 60, paying 2.00 a year. */
export function assetDetail(over: Partial<AssetDetailDTO> = {}): AssetDetailDTO {
  return {
    profile: {
      symbol: "KO",
      name: "Example Beverages",
      exchange: "XNYS",
      currency: "USD",
      assetType: "stock",
      sector: "consumer_defensive",
      industry: "Beverages",
      marketCap: "250000000000",
      peRatio: "24.5",
      beta: "0.6",
      fiftyTwoWeekHigh: usd("70"),
      fiftyTwoWeekLow: usd("55"),
      website: "https://example.com",
      description: "Makes and sells drinks.",
      ceo: "A. Person",
      fullTimeEmployees: "79000",
      ipoDate: null,
      country: "United States",
      countryIso: "US",
      fund: null,
    },
    quote: { price: usd("60"), asOf: TODAY },
    chart: [
      { date: day(-1), close: usd("59") },
      { date: TODAY, close: usd("60") },
    ],
    dividends: { history: quarterlyHistory(), cagr5y: "0.050000", trailingTwelveMonthTotal: "2" },
    position: {
      held: true,
      quantity: "100",
      averageCost: usd("40"),
      costBasis: usd("4000"),
      marketValue: usd("6000"),
      unrealizedGainLoss: usd("2000"),
      gainLossPercent: 50,
      dividendsReceived: { amount: "150.00", currency: "USD", leftOut: 0 },
      yieldOnCost: 0.05,
      feesPaid: usd("4"),
      trades: [],
    },
    income: {
      currentYield: 0.033333,
      yieldOnCost: 0.05,
      annualDividend: usd("2"),
      dividendGrowth5y: "0.050000",
      nextExDate: day(61),
      payoutRatio: 0.7,
    },
    upcoming: [
      upcomingRow(61, { certainty: "confirmed" }),
      upcomingRow(152),
      upcomingRow(243),
      upcomingRow(334),
      upcomingRow(425, { window: "longRange" }),
    ],
    yieldRange5y: { low: 0.02, high: 0.05, current: 0.033333, from: day(-1826) },
    profileAsOf: TODAY,
    custom: null,
    ...over,
  };
}

export function notHeld(detail: AssetDetailDTO = assetDetail()): AssetDetailDTO {
  return { ...detail, position: { held: false }, income: { ...detail.income, yieldOnCost: null } };
}

/** A holding that has never paid. */
export function nonPayer(detail: AssetDetailDTO = assetDetail()): AssetDetailDTO {
  return {
    ...detail,
    dividends: { history: [], cagr5y: null, trailingTwelveMonthTotal: "0" },
    upcoming: [],
    yieldRange5y: null,
    income: {
      ...detail.income,
      currentYield: null,
      yieldOnCost: null,
      annualDividend: null,
      payoutRatio: null,
    },
  };
}

export function fundDetail(): AssetDetailDTO {
  const base = assetDetail();
  return {
    ...base,
    profile: {
      ...base.profile,
      symbol: "FJORD.OL",
      name: "Example Global Fund",
      assetType: "etf",
      sector: null,
      industry: null,
      marketCap: null,
      peRatio: null,
      beta: null,
      ceo: null,
      fullTimeEmployees: null,
      website: null,
      country: "Ireland",
      countryIso: "IE",
      fund: {
        expenseRatio: "0.002",
        totalAssets: "7790000000",
        family: "Example Funds",
        category: "Global Large-Cap Blend Equity",
        legalType: "–",
        holdings: [
          { name: "Alpha Corp", symbol: "AAPL", weight: 0.05 },
          { name: "Beta Corp", symbol: "MSFT", weight: 0.04 },
        ],
        sectorWeightings: [
          { sector: "healthcare", weight: 0.12 },
          { sector: "technology", weight: 0.25 },
          { sector: "energy", weight: 0.04 },
        ],
      },
    },
    income: { ...base.income, payoutRatio: null },
  };
}

export function ratings(over: Partial<AnalystRatingsDTO> = {}): AnalystRatingsDTO {
  return {
    consensusKey: "buy",
    distribution: { strongBuy: 3, buy: 9, hold: 6, sell: 1, strongSell: 0 },
    targets: { low: usd("50"), mean: usd("66"), high: usd("80"), median: null },
    // Deliberately NOT the header's 60: anything computed from this is the
    // two-prices bug the redesign removes.
    currentPrice: usd("64"),
    analystCount: 19,
    asOf: `${TODAY}T08:00:00.000Z`,
    upgradeHistory: [],
    ...over,
  };
}

/** The book around the fixture holding: 6,000 of 75,000 — an 8.0% weight. */
export function bookPositions(): PositionDTO[] {
  const row = (symbol: string, value: string): PositionDTO => ({
    symbol,
    name: symbol,
    exchange: "XNYS",
    currency: "USD",
    nativeCurrency: "USD",
    quantity: "1",
    averageCost: usd(value),
    costBasis: usd(value),
    currentPrice: usd(value),
    marketValue: usd(value),
    unrealizedGainLoss: usd("0"),
    gainLossPercent: 0,
    dailyChange: null,
    dailyChangePercent: null,
    dividendIncome: null,
    totalReturn: null,
    totalReturnPercent: null,
    website: null,
    yieldOnCost: null,
    basisMismatch: null,
  });
  return [row("KO", "6000"), row("O", "69000")];
}
