import { eq } from "drizzle-orm";
import {
  EodhdClient,
  searchResponseSchema,
  parse,
  eodhdToAppSymbol,
  appSymbolToEodhd,
} from "@sage/provider-eodhd";
import { instrument } from "../db/schema";
import type { Database } from "../db/client";

// EODHD exchange codes ranked by preference when picking a "primary" listing.
const EXCHANGE_PRIORITY: string[] = [
  "US", // NYSE / NASDAQ / Arca
  "LSE", // London
  "XETRA", // Frankfurt (Xetra)
  "ST", // Stockholm
  "CO", // Copenhagen
  "OL", // Oslo
  "HE", // Helsinki
  "PA", // Euronext Paris
  "AS", // Euronext Amsterdam
  "BR", // Euronext Brussels
  "MI", // Milan
  "SW", // SIX Swiss
  "MC", // Madrid
  "F", // Frankfurt (Boerse)
];

export interface Listing {
  code: string;
  /** EODHD exchange code, e.g. "US", "XETRA". */
  exchange: string;
  /** Whether the listing has price data (EODHD search returns previousClose). */
  hasPrice: boolean;
}

export function pickPrimaryListing(listings: Listing[]): string | null {
  const tradeable = listings.filter((l) => l.hasPrice);
  const pool = tradeable.length > 0 ? tradeable : listings;
  if (pool.length === 0) return null;

  const rank = (exchange: string) => {
    const i = EXCHANGE_PRIORITY.indexOf(exchange);
    return i === -1 ? EXCHANGE_PRIORITY.length : i;
  };

  let best = pool[0]!;
  for (let i = 1; i < pool.length; i++) {
    if (rank(pool[i]!.exchange) < rank(best.exchange)) best = pool[i]!;
  }
  return eodhdToAppSymbol(best.code, best.exchange);
}

/** Resolves an instrument's ISIN and primary listing via EODHD's search API.
 *  Both lookups are best-effort: without a token, or on any failure, they
 *  return null and the instrument simply stays unresolved. */
export class IsinResolver {
  private client: EodhdClient | null;

  constructor(apiToken?: string) {
    this.client = apiToken ? new EodhdClient({ apiToken }) : null;
  }

  async resolveIsin(symbol: string): Promise<{ isin: string; exchange: string } | null> {
    if (!this.client) return null;
    try {
      const eodhdSymbol = appSymbolToEodhd(symbol); // "EUDIV.DE" -> "EUDIV.XETRA"
      const at = eodhdSymbol.lastIndexOf(".");
      const code = eodhdSymbol.slice(0, at);
      const wanted = eodhdSymbol.slice(at + 1);
      const raw = await this.client.request(`/search/${encodeURIComponent(code)}`);
      const results = parse(searchResponseSchema, raw);
      const candidates = results.filter(
        (r) => r.Code.toUpperCase() === code.toUpperCase() && r.ISIN,
      );
      if (candidates.length === 0) return null;
      const match = candidates.find((r) => r.Exchange === wanted) ?? candidates[0]!;
      return { isin: match.ISIN!, exchange: match.Exchange };
    } catch {
      return null;
    }
  }

  async findPrimaryListing(isin: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.request(`/search/${encodeURIComponent(isin)}`);
      const results = parse(searchResponseSchema, raw);
      const listings: Listing[] = results.map((r) => ({
        code: r.Code,
        exchange: r.Exchange,
        hasPrice: r.previousClose != null,
      }));
      return pickPrimaryListing(listings);
    } catch {
      return null;
    }
  }

  async resolveAndStore(db: Database, symbol: string): Promise<void> {
    const [inst] = await db.select().from(instrument).where(eq(instrument.symbol, symbol));
    if (!inst || inst.isin) return;

    const resolved = await this.resolveIsin(symbol);
    if (!resolved) return;

    let primarySymbol: string | null = null;
    const primary = await this.findPrimaryListing(resolved.isin);
    if (primary && primary !== symbol) {
      primarySymbol = primary;
    }

    await db
      .update(instrument)
      .set({ isin: resolved.isin, primarySymbol })
      .where(eq(instrument.symbol, symbol));
  }
}
