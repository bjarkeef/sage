import type { SearchResultDTO } from "./types";

const ASSET_TYPES = ["stock", "etf", "fund", "index", "other"] as const;
type AssetType = (typeof ASSET_TYPES)[number];

function narrowAssetType(value: string | undefined): AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value ?? "") ? (value as AssetType) : "other";
}

/**
 * Build the instrument shape `createTransaction` expects from whatever a page
 * already has.
 *
 * `AssetProfileDTO.assetType` is a widened `string` and `PositionDTO` has no
 * asset type at all, so both need narrowing. Falling back to `"other"` is safe
 * for anything already held: the API's `ensureInstrument` writes `assetType`
 * on insert only and leaves an existing row's type alone.
 */
export function toSearchResult(input: {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  assetType?: string;
}): SearchResultDTO {
  return {
    symbol: input.symbol,
    name: input.name,
    exchange: input.exchange,
    currency: input.currency,
    assetType: narrowAssetType(input.assetType),
  };
}
