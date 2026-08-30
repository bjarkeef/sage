/**
 * Asset profile cache: the one place that fetches a profile from a provider and
 * stores it in `asset_profile`.
 *
 * It used to live inside the asset route, which meant a profile existed only
 * for symbols whose asset page someone had opened. Every other reader —
 * diversification above all — reads this table and got nothing, so a freshly
 * imported book showed `Unknown` for sector, country and region until the owner
 * had visited each holding's page one at a time. Nothing said so.
 * `backfillProfiles` is the other half of the fix: the paths that introduce
 * held symbols call it, so the data is there before anyone looks.
 */
import { eq } from "drizzle-orm";
import { Decimal, Money } from "@sage/core";
import type {
  IMarketDataProvider,
  AssetProfile,
  AssetType,
  FundProfile,
  FundHolding,
  SectorWeight,
} from "@sage/provider-interface";
import type { Database } from "../db/client";
import { instrument, assetProfile } from "../db/schema";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Rebuild a FundProfile from cached asset_profile columns, or null for non-funds. */
function fundFromCache(c: {
  fundExpenseRatio: string | null;
  fundTotalAssets: string | null;
  fundFamily: string | null;
  fundCategory: string | null;
  fundLegalType: string | null;
  fundHoldings: FundHolding[] | null;
  fundSectorWeightings: SectorWeight[] | null;
}): FundProfile | null {
  const hasFund =
    c.fundFamily != null ||
    c.fundExpenseRatio != null ||
    c.fundLegalType != null ||
    c.fundCategory != null ||
    c.fundTotalAssets != null ||
    (c.fundHoldings?.length ?? 0) > 0;
  if (!hasFund) return null;
  return {
    expenseRatio: c.fundExpenseRatio ? new Decimal(c.fundExpenseRatio) : null,
    totalAssets: c.fundTotalAssets ? new Decimal(c.fundTotalAssets) : null,
    family: c.fundFamily,
    category: c.fundCategory,
    legalType: c.fundLegalType,
    holdings: c.fundHoldings ?? [],
    sectorWeightings: c.fundSectorWeightings ?? [],
  };
}

export async function getCachedOrFetchProfile(
  db: Database,
  provider: IMarketDataProvider,
  symbol: string,
): Promise<AssetProfile> {
  const [cached] = await db.select().from(assetProfile).where(eq(assetProfile.symbol, symbol));

  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return {
      symbol: cached.symbol,
      name: cached.name,
      exchange: cached.exchange,
      currency: cached.currency,
      assetType: cached.assetType as AssetType,
      sector: cached.sector,
      industry: cached.industry,
      marketCap: cached.marketCap ? new Decimal(cached.marketCap) : null,
      peRatio: cached.peRatio ? new Decimal(cached.peRatio) : null,
      beta: cached.beta ? new Decimal(cached.beta) : null,
      fiftyTwoWeekHigh: cached.fiftyTwoWeekHigh
        ? Money.of(cached.fiftyTwoWeekHigh, cached.currency)
        : null,
      fiftyTwoWeekLow: cached.fiftyTwoWeekLow
        ? Money.of(cached.fiftyTwoWeekLow, cached.currency)
        : null,
      dividendYield: cached.dividendYield ? new Decimal(cached.dividendYield) : null,
      payoutRatio: cached.payoutRatio ? new Decimal(cached.payoutRatio) : null,
      trailingAnnualDividend: cached.trailingAnnualDividend
        ? Money.of(cached.trailingAnnualDividend, cached.currency)
        : null,
      website: cached.website,
      description: cached.description,
      ceo: cached.ceo,
      fullTimeEmployees: cached.fullTimeEmployees,
      ipoDate: cached.ipoDate,
      country: cached.country ?? null,
      countryIso: cached.countryIso ?? null,
      fund: fundFromCache(cached),
    };
  }

  const profile = await provider.getAssetProfile(symbol);

  // Ensure the instrument row exists (asset_profile has a FK to instrument.symbol).
  // Non-held symbols won't be in the instrument table yet.
  //
  // On conflict, upgrade a PLACEHOLDER name. A CSV without a name column
  // imports every row with the ticker as its name, and this fetch is the only
  // thing that ever learns better — `onConflictDoNothing` threw that away, so
  // holdings lists read "ABBV / ABBV" for good. The guard is deliberately
  // narrow: only a name equal to the symbol is a placeholder. Any other name
  // may have been set on purpose, and a provider does not get to overwrite it.
  await db
    .insert(instrument)
    .values({
      symbol: profile.symbol,
      name: profile.name,
      exchange: profile.exchange,
      currency: profile.currency,
      assetType: profile.assetType,
    })
    .onConflictDoUpdate({
      target: instrument.symbol,
      set: { name: profile.name },
      where: eq(instrument.name, instrument.symbol),
    });

  const row = {
    symbol: profile.symbol,
    name: profile.name,
    exchange: profile.exchange,
    currency: profile.currency,
    assetType: profile.assetType,
    sector: profile.sector,
    industry: profile.industry,
    marketCap: profile.marketCap?.toFixed() ?? null,
    peRatio: profile.peRatio?.toFixed() ?? null,
    beta: profile.beta?.toFixed() ?? null,
    fiftyTwoWeekHigh: profile.fiftyTwoWeekHigh?.toDecimal().toFixed() ?? null,
    fiftyTwoWeekLow: profile.fiftyTwoWeekLow?.toDecimal().toFixed() ?? null,
    dividendYield: profile.dividendYield?.toFixed() ?? null,
    payoutRatio: profile.payoutRatio?.toFixed() ?? null,
    trailingAnnualDividend: profile.trailingAnnualDividend?.toDecimal().toFixed() ?? null,
    website: profile.website,
    description: profile.description,
    ceo: profile.ceo,
    fullTimeEmployees: profile.fullTimeEmployees,
    ipoDate: profile.ipoDate,
    country: profile.country ?? null,
    countryIso: profile.countryIso ?? null,
    fundExpenseRatio: profile.fund?.expenseRatio?.toFixed() ?? null,
    fundTotalAssets: profile.fund?.totalAssets?.toFixed() ?? null,
    fundFamily: profile.fund?.family ?? null,
    fundCategory: profile.fund?.category ?? null,
    fundLegalType: profile.fund?.legalType ?? null,
    fundHoldings: profile.fund?.holdings ?? null,
    fundSectorWeightings: profile.fund?.sectorWeightings ?? null,
    fetchedAt: new Date(),
  };

  await db
    .insert(assetProfile)
    .values(row)
    .onConflictDoUpdate({ target: assetProfile.symbol, set: row });

  return profile;
}

/**
 * Populate `asset_profile` for symbols that have no fresh entry, one at a time.
 *
 * Best-effort by design: it is called for its side effect on a table every
 * other view reads, never for a value, and a provider that is down or rate
 * limiting must not fail the import or the transaction that triggered it. Each
 * symbol is caught on its own so one bad ticker cannot strand the rest.
 *
 * Sequential on purpose. The provider is an unofficial, unkeyed endpoint; a
 * hundred-row import firing a hundred parallel profile requests is exactly the
 * shape of traffic that gets an IP throttled, and nothing here is on a path
 * anyone is waiting for.
 */
export async function backfillProfiles(
  db: Database,
  provider: IMarketDataProvider,
  symbols: readonly string[],
): Promise<{ fetched: number; failed: number }> {
  let fetched = 0;
  let failed = 0;
  for (const symbol of symbols) {
    try {
      await getCachedOrFetchProfile(db, provider, symbol);
      fetched += 1;
    } catch {
      failed += 1;
    }
  }
  return { fetched, failed };
}
