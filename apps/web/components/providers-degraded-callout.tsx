"use client";

import { useQuery } from "@tanstack/react-query";
import { Callout } from "@sage/ui";
import { getSystemStatus } from "../lib/api";
import { formatSecondsAgo, providerLabel } from "../lib/format";
import { qk } from "../lib/query/keys";
import type { ProviderHealthDTO } from "../lib/types";

/** A provider that answered within this long is taken to be mid-fetch, not down. */
const RECENT_SUCCESS_SECONDS = 600;

/** Plain-language cause, phrased as something the reader can act on. */
function reasonPhrase(health: ProviderHealthDTO): string {
  switch (health.lastFailureReason) {
    case "rate-limited":
      return "has spent its daily allowance";
    case "auth":
      return "rejected the API key";
    default:
      return "is unreachable";
  }
}

/**
 * One instance-wide notice when prices are missing or have stopped refreshing.
 *
 * Two distinct failures, and the difference is what the reader sees on the page:
 *
 *  - `pricesMissing > 0` — held symbols with nothing stored, so those rows read
 *    "unavailable". This is the FRESH-instance case: a first fetch that lands
 *    during an outage writes nothing, and with nothing written there is no age,
 *    so `pricesStale` is correctly false. Gating on staleness alone left a new
 *    instance with a blank dashboard and no explanation at all.
 *  - `pricesStale` — something IS stored, it is just old. The numbers are
 *    present and wrong-ish rather than absent, so the age leads.
 *
 * Missing wins when both hold: an absent price is the more serious of the two,
 * and the reader is looking at the empty rows it explains. Either way the
 * provider health registry supplies the cause; when health has reset (an API
 * restart) but Postgres still shows the problem, the notice stands without one.
 *
 * Rendered once in the app shell, not per page. Deliberately not per holding:
 * which row is old is noise, why nothing is updating is the story.
 */
export function ProvidersDegradedCallout() {
  const { data } = useQuery({
    queryKey: qk.systemStatus(),
    queryFn: getSystemStatus,
    staleTime: 60_000,
  });

  const providers = data?.providers;
  if (!providers) return null;

  const missing = providers.pricesMissing > 0;
  if (!missing && !providers.pricesStale) return null;

  const degraded = providers.health.filter((h) => h.state === "degraded");

  // Nothing stored YET, from a provider that is answering: new holdings whose
  // first fetch is still under way, which is every import. Saying "unavailable"
  // there greeted a first-time user with an outage at the moment their book
  // arrived. Needs a recent success, not just the absence of failure — after an
  // API restart health reads `unknown` and the real warning below must stand.
  const fetching =
    missing &&
    !providers.pricesStale &&
    degraded.length === 0 &&
    providers.health.some(
      (h) =>
        h.state === "healthy" &&
        h.lastSuccessSecondsAgo !== null &&
        h.lastSuccessSecondsAgo < RECENT_SUCCESS_SECONDS,
    );
  if (fetching) {
    const n = providers.pricesMissing;
    return (
      <Callout tone="info" className="mb-4">
        {`Fetching prices for ${n} ${n === 1 ? "holding" : "holdings"}.`}
      </Callout>
    );
  }

  const causes = degraded.map((h) => `${providerLabel(h.name)} ${reasonPhrase(h)}`).join(" and ");

  const lead = missing
    ? "Prices are unavailable"
    : `Prices last updated ${formatSecondsAgo(providers.pricesAgeSeconds)}`;

  return (
    <Callout tone="info" className="mb-4">
      {causes ? `${lead} — ${causes}. See Settings → System.` : `${lead}. See Settings → System.`}
    </Callout>
  );
}
