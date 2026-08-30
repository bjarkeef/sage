"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardTitle, DataRow, RowCell, RowGrid, RowHeader } from "@sage/ui";
import { getSystemStatus } from "@/lib/api";
import { formatSecondsAgo, formatUptime, providerLabel } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import type { FxPairStatusDTO, ProviderHealthDTO, SystemDTO } from "@/lib/types";

/** Sage renders dates via the platform locale; keep this consistent with it. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** `ratesAsOf` is a bare YYYY-MM-DD; parse as UTC so it cannot slip a
 *  day in a negative-offset timezone. */
function formatAsOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return formatDate(new Date(Date.UTC(y, m - 1, d)).toISOString());
}

/** The right-hand cell of an FX row: where the rate came from, and how old. */
function sourceCell(pair: FxPairStatusDTO, ratesAsOf: string | null) {
  switch (pair.source) {
    case "ecb":
      return {
        primary: "ECB",
        secondary: ratesAsOf ? `published ${formatAsOf(ratesAsOf)}` : "reference rate",
      };
    case "unavailable":
      return { primary: "Unavailable", secondary: "shown unconverted" };
  }
}

function fxSummary(fx: SystemDTO["fx"]): string {
  const unavailable = fx.pairs.filter((p) => p.source === "unavailable").length;
  if (!fx.displayCurrency)
    return "No display currency set — amounts are shown in their own currency, nothing converts.";
  if (fx.pairs.length === 0) return `Everything is already in ${fx.displayCurrency}.`;
  if (unavailable > 0)
    return `${unavailable} ${unavailable === 1 ? "currency has" : "currencies have"} no rate — those amounts are left unconverted.`;
  return fx.ratesAsOf
    ? `ECB euro reference rates, published ${formatAsOf(fx.ratesAsOf)}.`
    : "ECB euro reference rates in use.";
}

/** One provider's status line: what is wrong, and when it last worked. */
function healthValue(health: ProviderHealthDTO): string {
  if (health.state === "unknown") return "not used yet";
  if (health.state === "healthy")
    return `healthy · last success ${formatSecondsAgo(health.lastSuccessSecondsAgo)}`;
  const cause =
    health.lastFailureReason === "rate-limited"
      ? "daily allowance spent"
      : health.lastFailureReason === "auth"
        ? "key rejected"
        : "unreachable";
  // A single failed call is unremarkable — the streak count only earns its
  // place once it says something a lone failure can't: that this isn't a
  // one-off blip.
  const streak = health.consecutiveFailures > 1 ? ` (${health.consecutiveFailures} in a row)` : "";
  // Includes when the failure happened, not just when it last worked — without
  // it, a provider that failed once at boot and was never called again reads
  // identically to one that just failed, with nothing marking the finding stale.
  return `${cause} ${formatSecondsAgo(health.lastFailureSecondsAgo)}${streak} · last success ${formatSecondsAgo(health.lastSuccessSecondsAgo)}`;
}

/** A labelled group of label/value pairs inside the card. */
function InfoGroup({ label, rows }: { label: string; rows: [string, string][] }) {
  return (
    <div>
      <h4 className="label-caps text-muted-foreground">{label}</h4>
      <dl className="mt-2 space-y-1.5">
        {rows.map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-4">
            <dt className="text-xs text-muted-foreground">{key}</dt>
            <dd className="font-mono text-data tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Read-only insight into the running instance: what it is configured with, and
 * which exchange rate every held currency is actually converting at.
 *
 * The FX block is served by the same lookup the portfolio views use, so it
 * cannot disagree with the totals it exists to explain. The API sends key
 * presence as booleans and never the values.
 */
export function SystemSection() {
  const { data, isLoading } = useQuery({
    queryKey: qk.systemStatus(),
    queryFn: getSystemStatus,
    staleTime: 60_000,
  });

  return (
    <div className="mt-8">
      <Card className="space-y-5">
        <CardTitle
          meta={data ? formatUptime(data.environment.uptimeSeconds) + " uptime" : undefined}
        >
          System
        </CardTitle>

        {isLoading && <p className="text-xs text-muted-foreground">Reading system status…</p>}

        {data && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <InfoGroup
                label="Environment"
                rows={[
                  ["Mode", data.environment.nodeEnv],
                  ["Node", data.environment.nodeVersion],
                  ["Signups", data.environment.signups],
                  [
                    "Migrations",
                    data.environment.schemaMigrations == null
                      ? "—"
                      : String(data.environment.schemaMigrations),
                  ],
                ]}
              />
              <InfoGroup
                label="Providers"
                rows={[
                  ["Market data", data.providers.marketData],
                  ["Enrichment", data.providers.enrichment],
                  ["EODHD key", data.providers.keys.eodhd ? "configured" : "not set"],
                  ...data.providers.health.map((h): [string, string] => [
                    providerLabel(h.name),
                    healthValue(h),
                  ]),
                ]}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Provider status reflects live calls only — a cached answer is not evidence the
              provider is up, so “last success” can lag by up to a minute for quotes and up to 15
              minutes for history and dividends.
            </p>

            <div>
              <h4 className="label-caps text-muted-foreground">Exchange rates</h4>
              <p className="mt-1 text-xs text-muted-foreground">{fxSummary(data.fx)}</p>
              {data.fx.coverageFrom && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Historical coverage from {formatAsOf(data.fx.coverageFrom)}.
                </p>
              )}
              {data.fx.pairs.length > 0 && (
                <RowGrid columns="minmax(0,1fr) minmax(0,1fr) minmax(0,10rem)" className="mt-2">
                  <RowHeader
                    cells={["Currency", "Rate", "Source"]}
                    align={["left", "right", "right"]}
                  />
                  {data.fx.pairs.map((pair) => {
                    const source = sourceCell(pair, data.fx.ratesAsOf);
                    return (
                      <DataRow key={pair.from}>
                        <RowCell variant="text" primary={`${pair.from} → ${pair.to}`} />
                        <RowCell
                          align="right"
                          primary={pair.rate ? `${pair.rate} ${pair.to}` : "—"}
                          secondary={pair.rate ? `per 1 ${pair.from}` : undefined}
                        />
                        <RowCell
                          variant="text"
                          align="right"
                          primary={source.primary}
                          secondary={source.secondary}
                        />
                      </DataRow>
                    );
                  })}
                </RowGrid>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
