/**
 * Retry a live upstream call before believing it failed.
 *
 * Used only by `yahoo.live.ts`, the scheduled smoke check. It had no retry, so
 * it could not tell "upstream had a bad minute" from "upstream broke" — which
 * is the only thing it exists to say.
 *
 * On 2026-09-01 `getDividendHistory` returned HTTP 400 from a GitHub runner
 * while every other call in that job succeeded — including another chart
 * request, and two calls made after the failure — and all five passed from a
 * residential IP minutes later. Three lookback windows were probed nine times
 * there without a failure, so the request was not the fragile part: Yahoo's
 * unofficial API answers a datacenter IP differently.
 *
 * A genuine outage still fails every attempt, so the alarm survives while the
 * false alarm does not. Deliberately not in the provider itself: the app should
 * surface an outage immediately and fall back, not sit in a backoff loop.
 */
export async function retryLive<T>(
  fn: () => Promise<T>,
  backoffMs: readonly number[] = [2_000, 5_000],
  onRetry: (attempt: number, delayMs: number, error: Error) => void = defaultOnRetry,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // The last attempt's failure is the real answer; rethrow it untouched so
      // the reported error is upstream's own, not a wrapper.
      if (attempt >= backoffMs.length) throw error;
      const delayMs = backoffMs[attempt]!;
      onRetry(attempt + 1, delayMs, error as Error);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function defaultOnRetry(attempt: number, delayMs: number, error: Error): void {
  const firstLine = String(error?.message ?? error).split("\n")[0];
  console.warn(`[live] attempt ${attempt} failed, retrying in ${delayMs}ms: ${firstLine}`);
}
