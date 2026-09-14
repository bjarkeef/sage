"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Callout, Card, CardTitle, DataRow, RowCell, RowGrid, RowHeader } from "@sage/ui";
import { getSystemStatus } from "@/lib/api";
import { CurrencyPicker } from "@/components/currency-picker";
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

  // Uptime is withheld until after mount, so the server render and the first
  // client render agree that it is absent.
  //
  // This is a `meta` prop, and `CardTitle` renders the whole `<div>` only when
  // it is set — so a server/client disagreement here is not a text difference
  // React can reconcile, it is an element appearing out of nowhere, and it
  // threw "Hydration failed… this tree will be regenerated on the client" on
  // /settings. It reproduced intermittently, which is what a cache-warmth race
  // looks like: whether `data` is already resolved on the client's first
  // render depends on what the router had prefetched.
  //
  // Gating on mount removes the race outright rather than narrowing it. The
  // figure is a server-clock duration that never ticks once painted, so it has
  // no business participating in hydration in the first place.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const uptime =
    mounted && data ? `${formatUptime(data.environment.uptimeSeconds)} uptime` : undefined;

  return (
    <div className="mt-8">
      <Card className="space-y-5">
        <CardTitle meta={uptime}>System</CardTitle>

        {isLoading && <p className="text-xs text-muted-foreground">Reading system status…</p>}

        {/* Registration stays open after the owner signs up, because closing it
            takes an env change and a restart that nothing prompts for. As a
            plain row next to "Node version" it read as trivia; anyone who can
            reach the port can still create an account. */}
        {data?.environment.signups === "open" && (
          <Callout>
            <p className="font-medium">This instance is accepting new accounts.</p>
            <p className="mt-1 text-muted-foreground">
              Anyone who can reach it can register. Once you have your own account, set{" "}
              <code className="rounded-badge bg-surface-active px-1 py-0.5 text-xs">
                ALLOW_SIGNUP=false
              </code>{" "}
              and restart. You can still sign in; only new registrations stop.
            </p>
          </Callout>
        )}

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
              {/* The picker also lives in every money page's header, which is
                  where you change it in passing. It belongs here too because
                  this is the one place that *names* the setting — stating "No
                  display currency set" beside no way to set one sent people
                  looking through Settings for a control that was in the page
                  header all along. */}
              <div className="flex items-center justify-between gap-3">
                <h4 className="label-caps text-muted-foreground">Exchange rates</h4>
                <CurrencyPicker initialCurrency={data.fx.displayCurrency} />
              </div>
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
