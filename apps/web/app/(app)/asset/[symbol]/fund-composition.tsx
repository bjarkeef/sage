import { Card, SectionHeader } from "@sage/ui";
import { formatDate } from "../../../../lib/format";
import { prettySector } from "../../../../lib/asset-page/labels";
import type { FundProfileDTO } from "../../../../lib/types";

/** A label + horizontal weight bar, scaled so the largest entry fills the track. */
function WeightRow({ label, weight, max }: { label: string; weight: number; max: number }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-40 shrink-0 truncate text-sm">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${max > 0 ? (weight / max) * 100 : 0}%`, background: "var(--seg-2)" }}
        />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {(weight * 100).toFixed(2)}%
      </span>
    </div>
  );
}

/** A fund's top holdings and sector weights — both largest first (the provider
 *  sends sectors in its own order, which read as unsorted). */
export function FundComposition({ fund, asOf }: { fund: FundProfileDTO; asOf: string | null }) {
  if (fund.holdings.length === 0 && fund.sectorWeightings.length === 0) return null;
  const holdings = [...fund.holdings].sort((a, b) => b.weight - a.weight);
  const sectors = [...fund.sectorWeightings].sort((a, b) => b.weight - a.weight);
  const title = asOf
    ? `Provider figures, as of ${formatDate(asOf.slice(0, 10), { year: "always" })}`
    : "Provider figures";

  return (
    <section className="mb-10">
      <SectionHeader title="Fund composition" />
      <Card title={title}>
        <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
          {holdings.length > 0 && (
            <div className="min-w-0">
              <h3 className="mb-3 text-sm font-medium">Top holdings</h3>
              {holdings.map((h) => (
                <WeightRow
                  key={h.symbol ?? h.name}
                  label={h.name}
                  weight={h.weight}
                  max={holdings[0]!.weight}
                />
              ))}
            </div>
          )}
          {sectors.length > 0 && (
            <div className="min-w-0">
              <h3 className="mb-3 text-sm font-medium">Sector weights</h3>
              {sectors.map((s) => (
                <WeightRow
                  key={s.sector}
                  label={prettySector(s.sector)}
                  weight={s.weight}
                  max={sectors[0]!.weight}
                />
              ))}
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
