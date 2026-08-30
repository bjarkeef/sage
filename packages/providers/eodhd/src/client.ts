import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  SymbolNotFoundError,
} from "@sage/provider-interface";

export interface EodhdClientConfig {
  apiToken: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://eodhd.com/api";

/** The sole network boundary: builds the request, calls fetch, maps failures to the error taxonomy. */
export class EodhdClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: EodhdClientConfig) {
    this.apiToken = config.apiToken;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * `notFoundSymbol` is the app-level symbol to attach to a `SymbolNotFoundError`
   * when EODHD answers 404. It is optional because not every call site
   * represents a single symbol lookup (`searchSymbol` is a free-text query, and
   * a 404 there does not mean "this symbol does not exist") — callers that have
   * a symbol in scope should always pass it, so an out-of-universe symbol is
   * correctly classified as neutral rather than an outage (see
   * `apps/api/src/market-data/provider-health.ts`).
   */
  async request(
    path: string,
    options: { params?: Record<string, string>; notFoundSymbol?: string } = {},
  ): Promise<unknown> {
    const { params = {}, notFoundSymbol } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("api_token", this.apiToken);
    url.searchParams.set("fmt", "json");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await fetch(url);
    } catch (cause) {
      throw new ProviderUnavailableError("Failed to reach EODHD", { cause });
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderAuthError("EODHD rejected the API token");
    }
    // 402 is EODHD's exhausted-allowance signal on the free tier; 429 is the
    // per-second throttle. Both mean "come back later", not "the server broke",
    // and the System card leans on that distinction.
    if (response.status === 402 || response.status === 429) {
      throw new ProviderRateLimitError();
    }
    // A 404 for a single-symbol lookup means the symbol is outside EODHD's
    // universe — the ordinary case FallbackMarketDataProvider exists to
    // handle, not an outage. Must be classified before the generic !ok branch
    // below, or every unknown symbol would mark EODHD degraded.
    if (response.status === 404 && notFoundSymbol) {
      throw new SymbolNotFoundError(notFoundSymbol);
    }
    if (!response.ok) {
      throw new ProviderUnavailableError(`EODHD returned HTTP ${response.status}`);
    }

    try {
      return await response.json();
    } catch (cause) {
      throw new ProviderUnavailableError("EODHD returned a non-JSON response", { cause });
    }
  }
}
