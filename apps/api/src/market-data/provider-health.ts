import {
  ProviderAuthError,
  ProviderRateLimitError,
  SymbolNotFoundError,
} from "@sage/provider-interface";

/** Why a provider is considered down. Deliberately coarse — these three map to
 *  three different things a user can do about it. */
export type ProviderFailureReason = "rate-limited" | "auth" | "unavailable";

/** `unknown` = configured but not called since this process started. */
export type ProviderState = "healthy" | "degraded" | "unknown";

export interface ProviderHealth {
  name: string;
  state: ProviderState;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: ProviderFailureReason | null;
  consecutiveFailures: number;
}

/**
 * Classifies a thrown provider error, or returns null when it says nothing
 * about the provider's health.
 *
 * `SymbolNotFoundError` is the null case and it matters: a symbol outside a
 * provider's universe is the ORDINARY outcome that FallbackMarketDataProvider
 * exists to handle. Counting it would leave Yahoo permanently "degraded" for
 * anyone holding an instrument it does not cover, and a status surface that
 * cries wolf is worse than none.
 */
export function classifyFailure(error: unknown): ProviderFailureReason | null {
  if (error instanceof SymbolNotFoundError) return null;
  if (error instanceof ProviderRateLimitError) return "rate-limited";
  if (error instanceof ProviderAuthError) return "auth";
  return "unavailable";
}

interface Entry {
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: ProviderFailureReason | null;
  consecutiveFailures: number;
  lastOutcome: "success" | "failure" | null;
}

/**
 * In-memory, per-process record of which upstreams are answering.
 *
 * Deliberately not persisted: it describes THIS process since boot, which is
 * why the System card pairs it with uptime. `now` is injectable so tests never
 * depend on wall time.
 */
export class ProviderHealthRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Seed an entry so a configured-but-unused provider still appears, as
   *  `unknown`, instead of being missing from the card entirely. Idempotent:
   *  calling it on a live entry must not reset what has been recorded. */
  register(name: string): void {
    this.entryFor(name);
  }

  recordSuccess(name: string): void {
    const entry = this.entryFor(name);
    entry.lastSuccessAt = this.now();
    entry.consecutiveFailures = 0;
    entry.lastOutcome = "success";
  }

  recordFailure(name: string, error: unknown): void {
    const reason = classifyFailure(error);
    if (reason === null) return; // not a health signal — leave everything alone
    const entry = this.entryFor(name);
    entry.lastFailureAt = this.now();
    entry.lastFailureReason = reason;
    entry.consecutiveFailures += 1;
    entry.lastOutcome = "failure";
  }

  /** Name-sorted so the card's row order is stable across requests — entries
   *  are otherwise created in whatever order traffic happens to hit them. */
  snapshot(): ProviderHealth[] {
    return [...this.entries.entries()]
      .map(([name, entry]) => ({
        name,
        state: stateOf(entry),
        lastSuccessAt: entry.lastSuccessAt,
        lastFailureAt: entry.lastFailureAt,
        lastFailureReason: entry.lastFailureReason,
        consecutiveFailures: entry.consecutiveFailures,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private entryFor(name: string): Entry {
    let entry = this.entries.get(name);
    if (!entry) {
      entry = {
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureReason: null,
        consecutiveFailures: 0,
        lastOutcome: null,
      };
      this.entries.set(name, entry);
    }
    return entry;
  }
}

/**
 * Derived on read rather than stored, so the state can never disagree with
 * the outcome it summarises. Uses an explicit last-outcome flag rather than
 * comparing timestamps: when two outcomes share a millisecond (ordinary in
 * production where Promise.all quotes every holding simultaneously), a
 * timestamp comparison would silently report healthy even though the most
 * recent event was a failure. A flag is exact regardless of clock resolution.
 */
function stateOf(entry: Entry): ProviderState {
  if (entry.lastOutcome === null) return "unknown";
  if (entry.lastOutcome === "success") return "healthy";
  return "degraded";
}
