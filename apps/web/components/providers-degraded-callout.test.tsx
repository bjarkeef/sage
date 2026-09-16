import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";
import { qk } from "../lib/query/keys";
import { ProvidersDegradedCallout } from "./providers-degraded-callout";
import type { SystemDTO } from "../lib/types";

function systemWith(
  health: SystemDTO["providers"]["health"],
  prices: { pricesAgeSeconds: number | null; pricesStale: boolean; pricesMissing: number },
): SystemDTO {
  return {
    environment: {
      nodeEnv: "test",
      nodeVersion: "v22",
      uptimeSeconds: 10,
      signups: "open",
      schemaMigrations: 26,
    },
    providers: {
      marketData: "eodhd",
      enrichment: "yahoo",
      keys: { eodhd: true },
      health,
      ...prices,
    },
    fx: { displayCurrency: "DKK", ratesAsOf: null, coverageFrom: null, pairs: [] },
  };
}

const degraded = [
  {
    name: "eodhd",
    state: "degraded" as const,
    lastSuccessSecondsAgo: 14_400,
    lastFailureSecondsAgo: 5,
    lastFailureReason: "rate-limited" as const,
    consecutiveFailures: 3,
  },
];

const healthy = [
  {
    name: "yahoo",
    state: "healthy" as const,
    lastSuccessSecondsAgo: 12,
    lastFailureSecondsAgo: null,
    lastFailureReason: null,
    consecutiveFailures: 0,
  },
];

const STALE = { pricesAgeSeconds: 3 * 86_400, pricesStale: true, pricesMissing: 0 };
const CURRENT = { pricesAgeSeconds: 120, pricesStale: false, pricesMissing: 0 };
/** A brand-new instance whose very first fetch landed during an outage: nothing
 *  is stored, so there is no age and `pricesStale` is legitimately false. */
const MISSING = { pricesAgeSeconds: null, pricesStale: false, pricesMissing: 2 };

function render(system: SystemDTO) {
  const qc = makeTestQueryClient();
  qc.setQueryData(qk.systemStatus(), system);
  return renderWithClient((<ProvidersDegradedCallout />) as ReactElement, qc);
}

describe("ProvidersDegradedCallout", () => {
  it("leads with how old the prices are and names the cause", async () => {
    render(systemWith(degraded, STALE));
    expect(await screen.findByText(/last updated/i)).toBeInTheDocument();
    expect(screen.getByText(/EODHD/)).toBeInTheDocument();
    expect(screen.getByText(/daily allowance/i)).toBeInTheDocument();
  });

  // The whole point of persistence: a degraded provider whose stored prices are
  // still current is not worth alarming anyone about. Asserted on the sentence
  // both branches share, so this catches a callout that rendered the OTHER copy
  // — and on text rather than a role, because `Callout tone="info"` sets no
  // role and a role assertion would pass whether or not anything rendered.
  it("stays silent when prices are current despite a degraded provider", () => {
    render(systemWith(degraded, CURRENT));
    expect(screen.queryByText(/See Settings/i)).not.toBeInTheDocument();
  });

  it("stays silent when everything is healthy", () => {
    render(systemWith(healthy, CURRENT));
    expect(screen.queryByText(/See Settings/i)).not.toBeInTheDocument();
  });

  // A fresh instance during a total outage: no rows stored, so `pricesStale` is
  // false and an age-only gate would show nothing at all — a blank dashboard
  // with no explanation, which is what main did explain.
  it("reports prices as unavailable when held symbols have nothing stored", async () => {
    render(systemWith(degraded, MISSING));
    const text = await screen.findByText(/Prices are unavailable/i);
    expect(text).toBeInTheDocument();
    expect(text.textContent).toContain("EODHD");
    expect(text.textContent).toContain("daily allowance");
    // Never the age copy: there is no age to report.
    expect(screen.queryByText(/last updated/i)).not.toBeInTheDocument();
  });

  // After an API restart health resets to `unknown`, while Postgres still shows
  // nothing stored: the notice must stand, without a cause.
  it("still names the outage when nothing is stored and no provider has answered", async () => {
    const restarted = [
      {
        name: "yahoo",
        state: "unknown" as const,
        lastSuccessSecondsAgo: null,
        lastFailureSecondsAgo: null,
        lastFailureReason: null,
        consecutiveFailures: 0,
      },
    ];
    render(systemWith(restarted, MISSING));
    expect(await screen.findByText(/Prices are unavailable/i)).toBeInTheDocument();
  });

  // Found on a fresh install: straight after an import, the new holdings have
  // no stored price YET while the provider is answering fine. "Prices are
  // unavailable" greeted a first-time user at the moment their book arrived.
  it("says prices are on their way when a healthy provider has nothing stored yet", async () => {
    render(systemWith(healthy, MISSING));
    expect(await screen.findByText(/Fetching prices for 2 holdings/i)).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  // Missing beats stale: the reader is looking at empty rows, not old numbers.
  it("prefers the unavailable copy when prices are both missing and stale", async () => {
    render(systemWith(degraded, { ...STALE, pricesMissing: 1 }));
    expect(await screen.findByText(/Prices are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/last updated/i)).not.toBeInTheDocument();
  });

  // Survives an API restart: health resets to `unknown` in memory, but the age
  // comes from Postgres, so the warning must not vanish while data is still old.
  it("still warns when prices are stale but no provider is marked degraded", async () => {
    render(systemWith(healthy, STALE));
    expect(await screen.findByText(/last updated/i)).toBeInTheDocument();
  });
});
