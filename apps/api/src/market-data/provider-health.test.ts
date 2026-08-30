import { describe, it, expect } from "vitest";
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  SymbolNotFoundError,
} from "@sage/provider-interface";
import { ProviderHealthRegistry, classifyFailure } from "./provider-health";

/** A registry with a clock the test drives, so no assertion depends on wall time. */
function at(start = 1_000_000) {
  let now = start;
  const registry = new ProviderHealthRegistry(() => now);
  return { registry, advance: (ms: number) => (now += ms), now: () => now };
}

describe("classifyFailure", () => {
  it("maps the provider error taxonomy to reasons", () => {
    expect(classifyFailure(new ProviderRateLimitError())).toBe("rate-limited");
    expect(classifyFailure(new ProviderAuthError())).toBe("auth");
    expect(classifyFailure(new ProviderUnavailableError())).toBe("unavailable");
  });

  it("treats an unrecognised error as unavailable", () => {
    expect(classifyFailure(new Error("boom"))).toBe("unavailable");
    expect(classifyFailure("not even an error")).toBe("unavailable");
  });

  it("does not treat a missing symbol as a health signal", () => {
    expect(classifyFailure(new SymbolNotFoundError("NOPE"))).toBeNull();
  });
});

describe("ProviderHealthRegistry", () => {
  it("reports a registered but uncalled provider as unknown", () => {
    const { registry } = at();
    registry.register("yahoo");
    expect(registry.snapshot()).toEqual([
      {
        name: "yahoo",
        state: "unknown",
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureReason: null,
        consecutiveFailures: 0,
      },
    ]);
  });

  it("omits a provider that was never registered or called", () => {
    const { registry } = at();
    expect(registry.snapshot()).toEqual([]);
  });

  it("creates an entry on first record without registration", () => {
    const { registry } = at();
    registry.recordSuccess("eodhd");
    expect(registry.snapshot()).toHaveLength(1);
    expect(registry.snapshot()[0]!.name).toBe("eodhd");
  });

  it("marks a provider healthy on success", () => {
    const { registry, now } = at();
    registry.register("yahoo");
    registry.recordSuccess("yahoo");
    const [health] = registry.snapshot();
    expect(health!.state).toBe("healthy");
    expect(health!.lastSuccessAt).toBe(now());
  });

  it("marks a provider degraded on failure and records the reason", () => {
    const { registry, now } = at();
    registry.recordFailure("eodhd", new ProviderRateLimitError());
    const [health] = registry.snapshot();
    expect(health!.state).toBe("degraded");
    expect(health!.lastFailureAt).toBe(now());
    expect(health!.lastFailureReason).toBe("rate-limited");
    expect(health!.consecutiveFailures).toBe(1);
  });

  it("counts consecutive failures and resets the count on success", () => {
    const { registry, advance } = at();
    registry.recordFailure("yahoo", new ProviderUnavailableError());
    advance(1_000);
    registry.recordFailure("yahoo", new ProviderUnavailableError());
    expect(registry.snapshot()[0]!.consecutiveFailures).toBe(2);

    advance(1_000);
    registry.recordSuccess("yahoo");
    expect(registry.snapshot()[0]!.consecutiveFailures).toBe(0);
    expect(registry.snapshot()[0]!.state).toBe("healthy");
  });

  it("recovers to degraded when a failure follows a success", () => {
    const { registry, advance } = at();
    registry.recordSuccess("yahoo");
    advance(5_000);
    registry.recordFailure("yahoo", new ProviderAuthError());
    const [health] = registry.snapshot();
    expect(health!.state).toBe("degraded");
    // The earlier success is retained — the card shows how long it has been down.
    expect(health!.lastSuccessAt).not.toBeNull();
    expect(health!.lastFailureAt).toBeGreaterThan(health!.lastSuccessAt!);
  });

  it("leaves all state untouched for a missing symbol", () => {
    const { registry, advance } = at();
    registry.recordSuccess("yahoo");
    const before = registry.snapshot()[0];

    advance(10_000);
    registry.recordFailure("yahoo", new SymbolNotFoundError("NOPE"));

    expect(registry.snapshot()[0]).toEqual(before);
  });

  it("does not create an entry for a missing symbol on an unseen provider", () => {
    const { registry } = at();
    registry.recordFailure("ghost", new SymbolNotFoundError("NOPE"));
    expect(registry.snapshot()).toEqual([]);
  });

  it("returns providers in a stable, name-sorted order", () => {
    // Deliberately not the shipped provider names: the registry is a plain
    // name→health map with no knowledge of which adapters exist, so pinning
    // this to the current line-up would only mean editing it every time one is
    // added or dropped.
    const { registry } = at();
    registry.register("zeta");
    registry.register("alpha");
    registry.register("mu");
    expect(registry.snapshot().map((h) => h.name)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("keeps register idempotent so it cannot wipe live state", () => {
    const { registry } = at();
    registry.recordSuccess("yahoo");
    registry.register("yahoo");
    expect(registry.snapshot()[0]!.state).toBe("healthy");
  });

  it("determines state from the last outcome, not timestamp comparison (regression: same-millisecond outcomes)", () => {
    const { registry } = at();
    // Without advancing the clock, outcomes all land at the same timestamp.
    // State must still reflect the most recent outcome, not a timestamp comparison.
    registry.recordSuccess("yahoo");
    expect(registry.snapshot()[0]!.state).toBe("healthy");

    registry.recordFailure("yahoo", new ProviderUnavailableError());
    expect(registry.snapshot()[0]!.state).toBe("degraded");

    registry.recordSuccess("yahoo");
    expect(registry.snapshot()[0]!.state).toBe("healthy");
  });
});
