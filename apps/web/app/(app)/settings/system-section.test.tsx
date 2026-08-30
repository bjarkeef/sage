import type { ReactElement } from "react";
import { screen } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderWithClient, makeTestQueryClient } from "@/lib/test/render-with-client";
import type { FxPairStatusDTO, SystemDTO } from "@/lib/types";

const { getSystemStatusMock } = vi.hoisted(() => ({ getSystemStatusMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ getSystemStatus: getSystemStatusMock }));

import { SystemSection } from "./system-section";

function render(ui: ReactElement) {
  return renderWithClient(ui, makeTestQueryClient());
}

function systemDTO(overrides: Partial<SystemDTO> = {}): SystemDTO {
  return {
    environment: {
      nodeEnv: "development",
      nodeVersion: "v22.14.0",
      uptimeSeconds: 8040,
      signups: "closed",
      schemaMigrations: 23,
      ...overrides.environment,
    },
    providers: {
      marketData: "yahoo",
      enrichment: "none",
      keys: { eodhd: true },
      health: [],
      pricesAgeSeconds: null,
      pricesStale: false,
      pricesMissing: 0,
      ...overrides.providers,
    },
    fx: {
      displayCurrency: "DKK",
      ratesAsOf: "2026-07-24",
      coverageFrom: "1999-01-04",
      pairs: [],
      ...overrides.fx,
    },
  };
}

function pair(overrides: Partial<FxPairStatusDTO> = {}): FxPairStatusDTO {
  return {
    from: "USD",
    to: "DKK",
    rate: "6.5708",
    source: "ecb",
    ...overrides,
  };
}

describe("SystemSection", () => {
  beforeEach(() => getSystemStatusMock.mockReset());
  it("reports the runtime environment", async () => {
    getSystemStatusMock.mockResolvedValue(systemDTO());
    render(<SystemSection />);
    expect(await screen.findByText("development")).toBeInTheDocument();
    expect(screen.getByText("v22.14.0")).toBeInTheDocument();
    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
  });

  it("shows uptime, so a just-restarted API is visible", async () => {
    getSystemStatusMock.mockResolvedValue(systemDTO());
    render(<SystemSection />);
    expect(await screen.findByText(/2h 14m uptime/)).toBeInTheDocument();
  });

  it("shows an unreadable migration count as unknown rather than zero", async () => {
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        environment: {
          nodeEnv: "development",
          nodeVersion: "v22.14.0",
          uptimeSeconds: 10,
          signups: "open",
          schemaMigrations: null,
        },
      }),
    );
    render(<SystemSection />);
    expect(await screen.findByText("Migrations")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("reports which provider keys are configured without showing any value", async () => {
    getSystemStatusMock.mockResolvedValue(systemDTO());
    render(<SystemSection />);
    expect(await screen.findByText("EODHD key")).toBeInTheDocument();
    expect(screen.getByText("configured")).toBeInTheDocument(); // eodhd
    // The point of the row is that presence is reported and the value is not.
    expect(screen.queryByText(/eodhd-[A-Za-z0-9]/)).not.toBeInTheDocument();
  });

  it("renders a status line per provider", async () => {
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        providers: {
          marketData: "yahoo",
          enrichment: "none",
          keys: { eodhd: true },
          pricesAgeSeconds: null,
          pricesStale: false,
          pricesMissing: 0,
          health: [
            {
              name: "acme",
              state: "unknown",
              lastSuccessSecondsAgo: null,
              lastFailureSecondsAgo: null,
              lastFailureReason: null,
              consecutiveFailures: 0,
            },
            {
              name: "eodhd",
              state: "degraded",
              lastSuccessSecondsAgo: 14_400,
              lastFailureSecondsAgo: 5,
              lastFailureReason: "rate-limited",
              consecutiveFailures: 3,
            },
            {
              name: "yahoo",
              state: "healthy",
              lastSuccessSecondsAgo: 12,
              lastFailureSecondsAgo: null,
              lastFailureReason: null,
              consecutiveFailures: 0,
            },
          ],
        },
      }),
    );
    render(<SystemSection />);

    expect(await screen.findByText("healthy · last success 12s ago")).toBeInTheDocument();
    expect(
      screen.getByText("daily allowance spent 5s ago (3 in a row) · last success 4h ago"),
    ).toBeInTheDocument();
    expect(screen.getByText("not used yet")).toBeInTheDocument();
  });

  it("omits the streak count for a single failure, so a lone blip adds no noise", async () => {
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        providers: {
          marketData: "yahoo",
          enrichment: "none",
          keys: { eodhd: true },
          pricesAgeSeconds: null,
          pricesStale: false,
          pricesMissing: 0,
          health: [
            {
              name: "eodhd",
              state: "degraded",
              lastSuccessSecondsAgo: 100,
              lastFailureSecondsAgo: 5,
              lastFailureReason: "unavailable",
              consecutiveFailures: 1,
            },
          ],
        },
      }),
    );
    render(<SystemSection />);
    expect(await screen.findByText("unreachable 5s ago · last success 1m ago")).toBeInTheDocument();
  });

  it("names the streak count once failures repeat, so a sustained outage reads apart from a blip", async () => {
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        providers: {
          marketData: "yahoo",
          enrichment: "none",
          keys: { eodhd: true },
          pricesAgeSeconds: null,
          pricesStale: false,
          pricesMissing: 0,
          health: [
            {
              name: "eodhd",
              state: "degraded",
              lastSuccessSecondsAgo: 100,
              lastFailureSecondsAgo: 5,
              lastFailureReason: "unavailable",
              consecutiveFailures: 2,
            },
          ],
        },
      }),
    );
    render(<SystemSection />);
    expect(
      await screen.findByText("unreachable 5s ago (2 in a row) · last success 1m ago"),
    ).toBeInTheDocument();
  });

  it("marks a stale degraded verdict as stale, so it cannot be mistaken for a live one", async () => {
    // A provider that failed once at boot and was never called again must not
    // read identically to one that just failed — nothing else on the card
    // says the finding is hours old.
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        providers: {
          marketData: "yahoo",
          enrichment: "none",
          keys: { eodhd: true },
          pricesAgeSeconds: null,
          pricesStale: false,
          pricesMissing: 0,
          health: [
            {
              name: "eodhd",
              state: "degraded",
              lastSuccessSecondsAgo: null,
              lastFailureSecondsAgo: 14_400,
              lastFailureReason: "unavailable",
              consecutiveFailures: 1,
            },
          ],
        },
      }),
    );
    render(<SystemSection />);
    expect(await screen.findByText("unreachable 4h ago · last success —")).toBeInTheDocument();
  });

  it("says nothing is converting when no display currency is set", async () => {
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        fx: {
          displayCurrency: null,
          ratesAsOf: "2026-07-24",
          coverageFrom: "1999-01-04",
          pairs: [],
        },
      }),
    );
    render(<SystemSection />);
    expect(await screen.findByText(/No display currency set/i)).toBeInTheDocument();
  });

  it("shows an ECB pair oriented for reading", async () => {
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        fx: {
          displayCurrency: "DKK",
          ratesAsOf: "2026-07-24",
          coverageFrom: "1999-01-04",
          pairs: [pair({ rate: "6.25" })],
        },
      }),
    );
    render(<SystemSection />);
    expect(await screen.findByText("USD → DKK")).toBeInTheDocument();
    expect(screen.getByText("6.25 DKK")).toBeInTheDocument();
    expect(screen.getByText("per 1 USD")).toBeInTheDocument();
    expect(screen.getByText("ECB")).toBeInTheDocument();
  });

  it("names ECB and the publication day the rates come from", async () => {
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        fx: {
          displayCurrency: "DKK",
          ratesAsOf: "2026-07-24",
          coverageFrom: "1999-01-04",
          pairs: [pair()],
        },
      }),
    );
    render(<SystemSection />);
    // Date order is locale-dependent; assert the parts, not the arrangement.
    // Anchored so the row's cell and the summary line are told apart — both
    // carry the publication day.
    expect(await screen.findByText(/^published .*Jul.*2026$/i)).toBeInTheDocument();
    expect(
      screen.getByText(/^ECB euro reference rates, published .*Jul.*2026\.$/i),
    ).toBeInTheDocument();
  });

  it("still names the source when nothing has been published yet", async () => {
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        fx: {
          displayCurrency: "DKK",
          ratesAsOf: null,
          coverageFrom: "1999-01-04",
          pairs: [pair()],
        },
      }),
    );
    render(<SystemSection />);
    expect(await screen.findByText("ECB")).toBeInTheDocument();
    expect(screen.getByText(/ECB euro reference rates in use/i)).toBeInTheDocument();
  });

  it("shows how far back the stored ECB coverage reaches", async () => {
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        fx: {
          displayCurrency: "DKK",
          ratesAsOf: "2026-07-24",
          coverageFrom: "1999-01-04",
          pairs: [pair()],
        },
      }),
    );
    render(<SystemSection />);
    expect(await screen.findByText(/Jan.*1999/i)).toBeInTheDocument();
  });

  it("shows an unpriceable currency as unavailable with no rate", async () => {
    getSystemStatusMock.mockResolvedValue(
      systemDTO({
        fx: {
          displayCurrency: "DKK",
          ratesAsOf: "2026-07-24",
          coverageFrom: "1999-01-04",
          pairs: [pair({ from: "SEK", rate: null, source: "unavailable" })],
        },
      }),
    );
    render(<SystemSection />);
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/no rate — those amounts are left unconverted/i)).toBeInTheDocument();
  });
});
