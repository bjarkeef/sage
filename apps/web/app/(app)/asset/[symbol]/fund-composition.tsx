import { Card, SectionHeader } from "@sage/ui";
import type { FundProfileDTO } from "../../../../lib/types";
import { prettySector } from "./fundamentals-section";

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

export function FundComposition({ fund }: { fund: FundProfileDTO }) {
  if (fund.holdings.length === 0 && fund.sectorWeightings.length === 0) return null;

  return (
    <section className="mb-10">
      <SectionHeader title="Fund composition" />
      <Card>
        <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
          {fund.holdings.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-medium">Top holdings</h3>
              {(() => {
                const max = Math.max(...fund.holdings.map((h) => h.weight));
                return fund.holdings.map((h) => (
                  <WeightRow key={h.symbol ?? h.name} label={h.name} weight={h.weight} max={max} />
                ));
              })()}
            </div>
          )}
          {fund.sectorWeightings.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-medium">Sector weights</h3>
              {(() => {
                const max = Math.max(...fund.sectorWeightings.map((s) => s.weight));
                return fund.sectorWeightings.map((s) => (
                  <WeightRow
                    key={s.sector}
                    label={prettySector(s.sector)}
                    weight={s.weight}
                    max={max}
                  />
                ));
              })()}
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
