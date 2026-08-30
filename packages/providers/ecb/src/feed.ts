import { parseEurofxrefXml, type RateDay } from "./parse";

const DEFAULT_BASE_URL = "https://www.ecb.europa.eu/stats/eurofxref";

/**
 * Ceiling on a single ECB fetch, headers and body together.
 *
 * Without a signal, undici's defaults give a 10 s connect timeout but a **300 s**
 * headers timeout — so a host that accepts the TCP connection and then stalls
 * (captive portal, transparent proxy, misconfigured egress filter) hangs the
 * caller for five minutes. One of these fetches is awaited during boot, where
 * that is a five-minute outage, not a slow request. 30 s is far beyond the
 * measured ~310 ms worst case (the 951 KB full history) while staying inside
 * any reasonable startup budget.
 */
export const FETCH_TIMEOUT_MS = 30_000;

/**
 * Reader for the ECB euro foreign exchange reference rate feeds.
 *
 * Free, keyless and unrationed. ECB serves these files gzip-encoded and Node's
 * `fetch` negotiates and decompresses transparently, so the full history since
 * 1999 costs ~951 KB on the wire (measured 2026-08-08: 8.1 MB decoded,
 * 219,962 rate-days, ~310 ms).
 *
 * Every method degrades to `[]` rather than throwing — including on timeout:
 * callers treat "no rates" as an already-supported state, and an FX outage must
 * never take a page down, nor hang the caller waiting to find out.
 */
export class EcbFxFeed {
  /**
   * @param baseUrl Override for tests; defaults to ECB's public path.
   * @param timeoutMs Per-request ceiling; see {@link FETCH_TIMEOUT_MS}. A test
   *   shortens it so a stalled response can be exercised in milliseconds.
   */
  constructor(
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly timeoutMs: number = FETCH_TIMEOUT_MS,
  ) {}

  /** Today's rates only (~1.5 KB). Cheap enough for a blocking cold-start call. */
  fetchDaily(): Promise<RateDay[]> {
    return this.load("eurofxref-daily.xml");
  }

  /** The last 90 publication days (~70 KB). Catch-up for a short outage. */
  fetchRecent(): Promise<RateDay[]> {
    return this.load("eurofxref-hist-90d.xml");
  }

  /** Every publication day since 1999-01-04 (~951 KB gzipped). */
  fetchFullHistory(): Promise<RateDay[]> {
    return this.load("eurofxref-hist.xml");
  }

  private async load(file: string): Promise<RateDay[]> {
    try {
      const response = await fetch(`${this.baseUrl}/${file}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return [];
      return parseEurofxrefXml(await response.text());
    } catch {
      // Includes the abort: a timed-out fetch is just another "no rates".
      return [];
    }
  }
}
