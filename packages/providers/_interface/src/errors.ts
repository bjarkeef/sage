/** Base class for all provider errors. */
export class ProviderError extends Error {}

/**
 * The requested symbol does not exist at the provider.
 *
 * Throw this — with the symbol — for an out-of-universe lookup, never
 * `ProviderUnavailableError`. It is the contract adapter authors opt into:
 * provider-health tracking deliberately excludes this class from its failure
 * classification (see `classifyFailure` in
 * `apps/api/src/market-data/provider-health.ts`), because a provider that
 * simply does not carry a symbol is not a provider that is down.
 */
export class SymbolNotFoundError extends ProviderError {
  constructor(readonly symbol: string) {
    super(`Symbol not found: ${symbol}`);
    this.name = "SymbolNotFoundError";
  }
}

/** The provider rejected the request due to rate limiting. */
export class ProviderRateLimitError extends ProviderError {
  constructor(readonly retryAfterSeconds?: number) {
    super(
      retryAfterSeconds === undefined
        ? "Provider rate limit exceeded"
        : `Provider rate limit exceeded; retry after ${retryAfterSeconds}s`,
    );
    this.name = "ProviderRateLimitError";
  }
}

/** The provider rejected the credentials (missing or invalid API key). */
export class ProviderAuthError extends ProviderError {
  constructor(message = "Provider authentication failed") {
    super(message);
    this.name = "ProviderAuthError";
  }
}

/** The provider is unreachable or returned an unexpected/server error. */
export class ProviderUnavailableError extends ProviderError {
  constructor(message = "Provider is unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * The provider could serve this, but not on the plan it is configured with —
 * an endpoint or an exchange the plan does not include, or a local credit
 * budget already spent this minute.
 *
 * Like `SymbolNotFoundError`, provider-health tracking deliberately ignores it
 * (see `classifyFailure` in `apps/api/src/market-data/provider-health.ts`): a
 * free plan declining a European listing is the plan working as sold, and the
 * fallback chain serves the request from the next provider.
 */
export class ProviderPlanLimitError extends ProviderError {
  constructor(message = "Not available on the configured provider plan") {
    super(message);
    this.name = "ProviderPlanLimitError";
  }
}
