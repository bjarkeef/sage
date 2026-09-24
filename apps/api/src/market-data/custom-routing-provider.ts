import { eq } from "drizzle-orm";
import type {
  IMarketDataProvider,
  Quote,
  PriceBar,
  Dividend,
  SearchResult,
  AssetProfile,
  HistoryOptions,
} from "@sage/provider-interface";
import type { Database } from "../db/client";
import { instrument } from "../db/schema";

/** A user-defined instrument (instrument.asset_type = 'custom'), which no
 *  third-party provider knows about or should be asked about. */
export async function isCustomSymbol(db: Database, symbol: string): Promise<boolean> {
  const rows = await db
    .select({ assetType: instrument.assetType })
    .from(instrument)
    .where(eq(instrument.symbol, symbol))
    .limit(1);
  return rows[0]?.assetType === "custom";
}

/**
 * Routes custom instruments (instrument.asset_type = 'custom') to the local
 * manual-price provider — authoritatively, with NO fallthrough — and every
 * other symbol to the real provider chain. Deliberately not a fallback-chain
 * member: firstNonEmpty semantics would forward custom symbols upstream
 * (quota burn, garbage symbol matches).
 */
export class CustomRoutingProvider implements IMarketDataProvider {
  constructor(
    private readonly db: Database,
    private readonly manual: IMarketDataProvider,
    private readonly upstream: IMarketDataProvider,
  ) {}

  private isCustom(symbol: string): Promise<boolean> {
    return isCustomSymbol(this.db, symbol);
  }

  private async route(symbol: string): Promise<IMarketDataProvider> {
    return (await this.isCustom(symbol)) ? this.manual : this.upstream;
  }

  async getQuote(symbol: string): Promise<Quote> {
    return (await this.route(symbol)).getQuote(symbol);
  }

  async getHistoricalPrices(
    symbol: string,
    from: Date,
    to: Date,
    opts?: HistoryOptions,
  ): Promise<PriceBar[]> {
    return (await this.route(symbol)).getHistoricalPrices(symbol, from, to, opts);
  }

  async getDividendHistory(symbol: string): Promise<Dividend[]> {
    return (await this.route(symbol)).getDividendHistory(symbol);
  }

  async getAssetProfile(symbol: string): Promise<AssetProfile> {
    return (await this.route(symbol)).getAssetProfile(symbol);
  }

  /** Custom matches first (they're the user's own holdings), then upstream.
   *  An upstream failure must not hide local results. */
  async searchSymbol(query: string): Promise<SearchResult[]> {
    const local = await this.manual.searchSymbol(query);
    let remote: SearchResult[] = [];
    try {
      remote = await this.upstream.searchSymbol(query);
    } catch {
      // upstream unavailable — local results still stand
    }
    const seen = new Set(local.map((r) => r.symbol));
    return [...local, ...remote.filter((r) => !seen.has(r.symbol))];
  }
}
