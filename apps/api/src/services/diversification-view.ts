import { and, eq, inArray } from "drizzle-orm";
import { Decimal } from "@sage/core";
import { instrument, assetProfile, customHolding } from "../db/schema";
import { countryToRegion } from "../lib/region-map";
import { canonicalSectorLabel } from "../lib/sector-labels";
import type { PortfolioViewDeps } from "./portfolio-view";
import { loadPortfolioBook, type PortfolioBook } from "./portfolio-book";
import type { MoneyDTO } from "../dto";
import { getRatesWithProvenance } from "../market-data/fx-provenance";

export interface DimRowDTO {
  symbol: string;
  name: string;
  bucket: string;
  marketValue: MoneyDTO;
  costValue: MoneyDTO;
  isFund: boolean;
  /** X-ray fund slices only: % of the fund in this bucket (0–100, 2dp). */
  fundWeightPct?: number;
}

export interface ConstituentSourceDTO {
  type: "direct" | "fund";
  fundSymbol?: string;
  marketValue: MoneyDTO;
  costValue: MoneyDTO;
}

export interface ConstituentDTO {
  key: string;
  symbol: string | null;
  name: string;
  marketValue: MoneyDTO;
  costValue: MoneyDTO;
  sources: ConstituentSourceDTO[];
}

export interface DiversificationViewBody {
  currency: string;
  totals: { marketValue: MoneyDTO; costBasis: MoneyDTO };
  dimensions: {
    sector: { plain: DimRowDTO[]; xray: DimRowDTO[] };
    country: DimRowDTO[];
    region: DimRowDTO[];
    assetClass: DimRowDTO[];
    currency: DimRowDTO[];
  };
  holdingsXray: ConstituentDTO[];
  /** True when some held currency had no FX rate to the display currency —
   *  those values are passed through unconverted (labeled in the display
   *  currency); the client should surface this. */
  fxIncomplete: boolean;
  /** True when the stored ECB rates used for conversion are older than the
   *  staleness threshold — totals are approximate. Independent of
   *  `fxIncomplete`; both can be true. */
  fxStale: boolean;
  /** Publication date of the ECB rates used for conversion; null when no
   *  conversion was needed or no rates were stored. */
  fxRatesAsOf: string | null;
}

const FUND_TYPES = new Set(["etf", "fund"]);
/** Provider weights routinely sum to 0.9995; ignore residuals below this. */
const RESIDUAL_EPSILON = new Decimal("0.001");

export async function buildDiversificationView(
  deps: PortfolioViewDeps,
  userId: string,
  opts: { currency?: string | null; book?: PortfolioBook },
): Promise<DiversificationViewBody> {
  const { db, provider, fxRateService } = deps;
  const book =
    opts.book ?? (await loadPortfolioBook(db, userId, { currency: opts.currency ?? null }));
  const { portfolioId, positions } = book;
  // Diversification has to label in one concrete currency, because its buckets
  // are sums. Prefer the user's display currency; failing that the book's own,
  // when it has just one — a EUR-only book used to be converted into dollars
  // and labelled `$`, a currency its owner never picked, on the strength of a
  // hardcoded default here. A genuinely mixed book with no display currency
  // still has to land somewhere, and USD remains that somewhere.
  const bookCurrencies = new Set(positions.map((p) => p.currency));
  const currencyCode: string =
    book.targetCurrency ?? (bookCurrencies.size === 1 ? [...bookCurrencies][0]! : "USD");
  const money = (v: Decimal): MoneyDTO => ({ amount: v.toFixed(2), currency: currencyCode });

  if (positions.length === 0) {
    return {
      currency: currencyCode,
      totals: { marketValue: money(new Decimal(0)), costBasis: money(new Decimal(0)) },
      dimensions: {
        sector: { plain: [], xray: [] },
        country: [],
        region: [],
        assetClass: [],
        currency: [],
      },
      holdingsXray: [],
      fxIncomplete: false,
      fxStale: false,
      fxRatesAsOf: null,
    };
  }

  const symbols = positions.map((p) => p.symbol);
  const instrumentRows = await db
    .select()
    .from(instrument)
    .where(inArray(instrument.symbol, symbols));
  const instrumentMap = new Map(instrumentRows.map((i) => [i.symbol, i]));

  const profileRows = await db
    .select()
    .from(assetProfile)
    .where(inArray(assetProfile.symbol, symbols));
  const profileMap = new Map(profileRows.map((p) => [p.symbol, p]));

  const customRows = await db
    .select()
    .from(customHolding)
    .where(and(eq(customHolding.portfolioId, portfolioId), inArray(customHolding.symbol, symbols)));
  const customMap = new Map(customRows.map((c) => [c.symbol, c]));

  const marketRaw = new Map<string, Decimal>();
  await Promise.all(
    positions.map(async (pos) => {
      try {
        const quote = await provider.getQuote(pos.symbol);
        marketRaw.set(pos.symbol, quote.price.toDecimal().times(pos.quantity));
      } catch {
        marketRaw.set(pos.symbol, pos.costBasis.toDecimal());
      }
    }),
  );

  const currencies = [...new Set(positions.map((p) => p.currency))];
  const fxRates = new Map<string, Decimal>();
  let fxStale = false;
  let fxRatesAsOf: string | null = null;
  if (fxRateService && currencies.some((cur) => cur !== currencyCode)) {
    try {
      const { rates, stale, asOf } = await getRatesWithProvenance(
        fxRateService,
        currencyCode,
        currencies.filter((cur) => cur !== currencyCode),
      );
      for (const [ccy, rate] of rates) fxRates.set(ccy, rate);
      // Staleness is a property of the stored series as a whole, not of any one
      // pair: every rate here is cross-rated off the same publication day.
      fxStale = stale;
      fxRatesAsOf = asOf;
    } catch {
      // FX unavailable — values pass through unconverted and `fxIncomplete`
      // says so. Wrapped like every sibling view (portfolio, categories,
      // dividend income): the ECB service reads the database, so a DB hiccup
      // rejects here where the old cache-backed chain never threw, and a
      // 500 on /diversification would be a harder failure than any of them.
    }
  }

  // Rates are target/source (getRates("EUR", ["USD"]) → EURUSD-style 0.5),
  // so source→target converts by DIVIDING. A currency with no rate passes
  // through UNCONVERTED while still being labeled in the target currency —
  // the same behavior as every other view service (do not "fix" this here
  // alone); the condition is surfaced to the client via `fxIncomplete`.
  function toTargetCurrency(value: Decimal, fromCurrency: string): Decimal {
    if (fromCurrency === currencyCode) return value;
    const rate = fxRates.get(fromCurrency);
    if (!rate || rate.isZero()) return value;
    return value.dividedBy(rate);
  }
  const fxIncomplete = currencies.some((cur) => cur !== currencyCode && !fxRates.has(cur));

  interface Holding {
    symbol: string;
    name: string;
    marketValue: Decimal;
    costValue: Decimal;
    isFund: boolean;
    prof: (typeof profileRows)[number] | undefined;
    custom: (typeof customRows)[number] | undefined;
    inst: (typeof instrumentRows)[number] | undefined;
    posCurrency: string;
  }

  const holdings: Holding[] = positions.map((pos) => {
    const inst = instrumentMap.get(pos.symbol);
    const prof = profileMap.get(pos.symbol);
    const custom = customMap.get(pos.symbol);
    return {
      symbol: pos.symbol,
      name: inst?.name ?? pos.symbol,
      marketValue: toTargetCurrency(marketRaw.get(pos.symbol) ?? new Decimal(0), pos.currency),
      costValue: toTargetCurrency(pos.costBasis.toDecimal(), pos.currency),
      isFund: FUND_TYPES.has(prof?.assetType ?? inst?.assetType ?? ""),
      prof,
      custom,
      inst,
      posCurrency: pos.currency,
    };
  });

  const row = (h: Holding, bucket: string): DimRowDTO => ({
    symbol: h.symbol,
    name: h.name,
    bucket,
    marketValue: money(h.marketValue),
    costValue: money(h.costValue),
    isFund: h.isFund,
  });

  const sectorPlain: DimRowDTO[] = [];
  const sectorXray: DimRowDTO[] = [];
  const country: DimRowDTO[] = [];
  const region: DimRowDTO[] = [];
  const assetClass: DimRowDTO[] = [];
  const currencyDim: DimRowDTO[] = [];

  for (const h of holdings) {
    const sectorRaw = h.custom?.sector ?? h.prof?.sector ?? null;
    const plainBucket = h.isFund
      ? "Funds"
      : sectorRaw
        ? canonicalSectorLabel(sectorRaw)
        : "Unknown";
    sectorPlain.push(row(h, plainBucket));

    const weights = h.isFund ? (h.prof?.fundSectorWeightings ?? []) : [];
    if (h.isFund && weights.length > 0) {
      let covered = new Decimal(0);
      for (const w of weights) {
        const frac = new Decimal(w.weight);
        covered = covered.plus(frac);
        sectorXray.push({
          symbol: h.symbol,
          name: h.name,
          bucket: canonicalSectorLabel(w.sector),
          marketValue: money(h.marketValue.times(frac)),
          costValue: money(h.costValue.times(frac)),
          isFund: true,
          fundWeightPct: Number(frac.times(100).toFixed(2)),
        });
      }
      // Weights summing below 1 leave real value unclassified — surface it,
      // never drop it (spec §2). Weights above 1 are used as-is (spec §6).
      const residual = new Decimal(1).minus(covered);
      if (residual.greaterThan(RESIDUAL_EPSILON)) {
        sectorXray.push({
          symbol: h.symbol,
          name: h.name,
          bucket: "Unknown",
          marketValue: money(h.marketValue.times(residual)),
          costValue: money(h.costValue.times(residual)),
          isFund: true,
          fundWeightPct: Number(residual.times(100).toFixed(2)),
        });
      }
    } else {
      sectorXray.push(row(h, plainBucket));
    }

    country.push(row(h, h.custom?.country ?? h.prof?.country ?? "Unknown"));
    region.push(row(h, countryToRegion(h.prof?.countryIso ?? null)));
    assetClass.push(row(h, h.inst?.assetType ?? "other"));
    currencyDim.push(row(h, h.posCurrency));
  }

  interface ConstituentAcc {
    symbol: string | null;
    name: string;
    market: Decimal;
    cost: Decimal;
    sources: { type: "direct" | "fund"; fundSymbol?: string; market: Decimal; cost: Decimal }[];
  }
  const constituents = new Map<string, ConstituentAcc>();
  const addSource = (
    key: string,
    symbol: string | null,
    name: string,
    source: ConstituentAcc["sources"][number],
  ) => {
    const acc = constituents.get(key) ?? {
      symbol,
      name,
      market: new Decimal(0),
      cost: new Decimal(0),
      sources: [],
    };
    acc.market = acc.market.plus(source.market);
    acc.cost = acc.cost.plus(source.cost);
    acc.sources.push(source);
    constituents.set(key, acc);
  };

  for (const h of holdings) {
    const fundHoldings = h.isFund ? (h.prof?.fundHoldings ?? []) : [];
    if (h.isFund && fundHoldings.length > 0) {
      let covered = new Decimal(0);
      for (const fh of fundHoldings) {
        const frac = new Decimal(fh.weight);
        covered = covered.plus(frac);
        addSource(fh.symbol ?? fh.name.toLowerCase(), fh.symbol, fh.name, {
          type: "fund",
          fundSymbol: h.symbol,
          market: h.marketValue.times(frac),
          cost: h.costValue.times(frac),
        });
      }
      const residual = new Decimal(1).minus(covered);
      if (residual.greaterThan(RESIDUAL_EPSILON)) {
        addSource(`${h.symbol}:other`, null, `${h.symbol} — other holdings`, {
          type: "fund",
          fundSymbol: h.symbol,
          market: h.marketValue.times(residual),
          cost: h.costValue.times(residual),
        });
      }
    } else {
      // Funds without composition data behave like stocks — no fake look-through.
      addSource(h.symbol, h.symbol, h.name, {
        type: "direct",
        market: h.marketValue,
        cost: h.costValue,
      });
    }
  }

  const holdingsXray: ConstituentDTO[] = [...constituents.entries()]
    // Sort on the Decimal accumulators, not the rounded 2dp strings.
    .sort((a, b) => b[1].market.comparedTo(a[1].market))
    .map(([key, acc]) => ({
      key,
      symbol: acc.symbol,
      name: acc.name,
      marketValue: money(acc.market),
      costValue: money(acc.cost),
      sources: acc.sources.map((s) => ({
        type: s.type,
        ...(s.fundSymbol !== undefined ? { fundSymbol: s.fundSymbol } : {}),
        marketValue: money(s.market),
        costValue: money(s.cost),
      })),
    }));

  const totalMarket = holdings.reduce((sum, h) => sum.plus(h.marketValue), new Decimal(0));
  const totalCost = holdings.reduce((sum, h) => sum.plus(h.costValue), new Decimal(0));

  return {
    currency: currencyCode,
    totals: { marketValue: money(totalMarket), costBasis: money(totalCost) },
    dimensions: {
      sector: { plain: sectorPlain, xray: sectorXray },
      country,
      region,
      assetClass,
      currency: currencyDim,
    },
    holdingsXray,
    fxIncomplete,
    fxStale,
    fxRatesAsOf,
  };
}
