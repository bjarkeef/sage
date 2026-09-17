/**
 * Ceiling on a single market-data request, headers and body together.
 *
 * Without a signal, undici gives a 10 s connect timeout but a **300 s** headers
 * timeout, and no limit at all on a body that stops arriving. A provider host
 * that accepts the connection and then stalls would hold a background price
 * refresh for five minutes or forever — on a self-hosted box that runs for
 * months, that is a slow leak of stuck refreshes rather than one bad request.
 * Real responses take well under a second; 30 s matches the ECB feed's ceiling.
 */
export const PROVIDER_FETCH_TIMEOUT_MS = 30_000;

/**
 * A `fetch` that aborts after `timeoutMs`, with a fresh timer per call. A signal
 * the caller passes still works alongside it. The abort rejects with a
 * `TimeoutError`, which each adapter already maps to `ProviderUnavailableError`.
 *
 * `baseFetch` defaults to the global `fetch` looked up at call time, not at
 * construction, so test interceptors installed later still apply.
 */
export function timeoutFetch(
  timeoutMs: number = PROVIDER_FETCH_TIMEOUT_MS,
  baseFetch?: typeof fetch,
): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return (baseFetch ?? globalThis.fetch)(input, { ...init, signal });
  };
}
