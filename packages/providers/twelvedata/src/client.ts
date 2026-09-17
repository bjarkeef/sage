import {
  ProviderAuthError,
  ProviderPlanLimitError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  SymbolNotFoundError,
} from "@sage/provider-interface";

export type TwelveDataEndpoint =
  "quote" | "time_series" | "dividends" | "profile" | "symbol_search";

/** Credits per call, measured against the live API on 2026-09-16. */
const CREDIT_COST: Record<TwelveDataEndpoint, number> = {
  quote: 1,
  time_series: 1,
  dividends: 1,
  profile: 1,
  symbol_search: 0,
};

const DEFAULT_BASE_URL = "https://api.twelvedata.com";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a plan refusal is believed before asking again. */
const PLAN_MEMORY_MS = DAY_MS;

export interface TwelveDataClientConfig {
  apiKey: string;
  baseUrl?: string;
  /** The plan's per-minute credit allowance. Default 8, the free plan's. */
  creditsPerMinute?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface RequestOptions {
  /** `symbol@mic` (or a bare US ticker) — the key a plan refusal is remembered under. */
  listingKey?: string;
  /** The app symbol to put on a `SymbolNotFoundError`. */
  notFoundSymbol?: string;
  /** Resolve `null` instead of throwing when Twelve Data has no data for the range. */
  allowNoData?: boolean;
}

/**
 * The sole network boundary. Three guards run before anything is sent, in this
 * order, so an out-of-plan request never spends the budget:
 *
 * 1. a remembered plan refusal (endpoint or listing) — no request;
 * 2. a pause after a 429 — no request;
 * 3. this minute's credit budget — no request once it is spent.
 *
 * Every refusal fails fast rather than queueing. Prices are served from Postgres
 * and refreshed behind the response, so a skipped refresh costs freshness, never
 * a page, and the fallback chain hands the request to the next provider.
 */
export class TwelveDataClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly creditsPerMinute: number;
  private readonly now: () => number;

  private windowStart = -1;
  private spent = 0;
  private pausedUntil = 0;
  /** key -> expiry time */
  private readonly refused = new Map<string, number>();

  constructor(config: TwelveDataClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.creditsPerMinute = config.creditsPerMinute ?? 8;
    this.now = config.now ?? (() => Date.now());
  }

  async request(
    endpoint: TwelveDataEndpoint,
    params: Record<string, string>,
    options: RequestOptions = {},
  ): Promise<unknown> {
    const now = this.now();
    const endpointKey = `endpoint:${endpoint}`;
    const listingKey = options.listingKey ? `listing:${options.listingKey}` : null;
    if (this.isRefused(endpointKey, now) || (listingKey && this.isRefused(listingKey, now))) {
      throw new ProviderPlanLimitError(`Twelve Data: not on this plan (${endpoint})`);
    }
    if (now < this.pausedUntil) {
      throw new ProviderRateLimitError(Math.ceil((this.pausedUntil - now) / 1000));
    }
    const cost = CREDIT_COST[endpoint];
    // The window this call was charged in, so a refund below (which may land
    // after other calls have rolled the window over) only credits the window
    // it actually took the credit from.
    let chargedWindow = this.windowStart;
    if (cost > 0) {
      const window = Math.floor(now / MINUTE_MS) * MINUTE_MS;
      if (window !== this.windowStart) {
        this.windowStart = window;
        this.spent = 0;
      }
      if (this.spent + cost > this.creditsPerMinute) {
        throw new ProviderPlanLimitError("Twelve Data: this minute's credit budget is spent");
      }
      this.spent += cost;
      chargedWindow = this.windowStart;
    }

    const url = new URL(`${this.baseUrl}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `apikey ${this.apiKey}` } });
    } catch (cause) {
      throw new ProviderUnavailableError("Failed to reach Twelve Data", { cause });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new ProviderUnavailableError(
        `Twelve Data returned a non-JSON response (HTTP ${response.status})`,
        { cause },
      );
    }

    const envelope = errorEnvelope(body);
    const code = envelope?.code ?? (response.ok ? 0 : response.status);
    if (code === 0) return body;

    const message = envelope?.message ?? "";
    switch (true) {
      case code === 401:
        throw new ProviderAuthError("Twelve Data rejected the API key");
      case code === 429: {
        this.pausedUntil = /for the day/i.test(message)
          ? Math.floor(now / DAY_MS) * DAY_MS + DAY_MS
          : Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
        throw new ProviderRateLimitError(Math.ceil((this.pausedUntil - now) / 1000));
      }
      case code === 403 && /plan/i.test(message):
        // Only a refusal that names the endpoint ("/dividends is available
        // exclusively with…") closes it for every symbol. Any other plan
        // refusal is taken to be about this listing, so one out-of-plan symbol
        // never silently disables an endpoint the plan does include.
        if (namesEndpoint(message, endpoint)) this.remember(endpointKey, now);
        else if (listingKey) this.remember(listingKey, now);
        this.refund(cost, chargedWindow);
        throw new ProviderPlanLimitError(`Twelve Data: ${endpoint} is not on this plan`);
      case code === 403:
        throw new ProviderAuthError("Twelve Data refused the request");
      case code === 404 && /plan|upgrad/i.test(message):
        if (listingKey) this.remember(listingKey, now);
        this.refund(cost, chargedWindow);
        throw new ProviderPlanLimitError("Twelve Data: this listing is not on this plan");
      case code === 400 && /no data/i.test(message) && options.allowNoData === true:
        return null;
      case (code === 404 || code === 400) && options.notFoundSymbol !== undefined:
        throw new SymbolNotFoundError(options.notFoundSymbol);
      default:
        throw new ProviderUnavailableError(`Twelve Data returned ${code}: ${message}`.trim());
    }
  }

  private isRefused(key: string, now: number): boolean {
    const until = this.refused.get(key);
    if (until === undefined) return false;
    if (now < until) return true;
    this.refused.delete(key);
    return false;
  }

  private remember(key: string, now: number): void {
    this.refused.set(key, now + PLAN_MEMORY_MS);
  }

  /**
   * Gives back a credit a plan refusal did not actually spend — but only into
   * the window it was charged from. A response can arrive after the minute
   * window has rolled over (and been fully spent by other calls in between),
   * so crediting the *current* window instead could push it over the cap.
   */
  private refund(cost: number, chargedWindow: number): void {
    if (cost > 0 && this.windowStart === chargedWindow) {
      this.spent = Math.max(0, this.spent - cost);
    }
  }
}

/** True when a refusal message names the endpoint as a path, e.g. `/dividends`. */
function namesEndpoint(message: string, endpoint: TwelveDataEndpoint): boolean {
  return new RegExp(`(^|[^\\w/.])/${endpoint}\\b`).test(message);
}

function errorEnvelope(body: unknown): { code: number; message: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.status !== "error") return null;
  return {
    code: typeof b.code === "number" ? b.code : 500,
    message: typeof b.message === "string" ? b.message : "",
  };
}
