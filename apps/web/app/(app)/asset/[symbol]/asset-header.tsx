import Link from "next/link";
import { Chip } from "@sage/ui";
import { CompanyLogo } from "../../../../components/company-logo";
import { BasisMismatchMark } from "../../../../components/basis-mismatch-mark";
import { ChartReadoutLine } from "../../../../components/chart-readout-line";
import { formatMoney, formatDate } from "../../../../lib/format";
import type { ChartReadout } from "../../../../lib/asset-chart/readout";
import type { AssetProfileDTO, AssetDetailDTO, BasisFindingDTO } from "../../../../lib/types";

const HOLDING_TYPE_LABELS: Record<string, string> = {
  savings: "Savings account",
  pension: "Pension",
  other: "Other",
};

/**
 * Identity and the page's ONE current price. While the chart is scrubbed the
 * numeral becomes the hovered close and the readout the change to that day;
 * leaving the chart restores the quote.
 */
export function AssetHeader({
  profile,
  quote,
  held,
  custom,
  readout,
  basisMismatch,
}: {
  profile: AssetProfileDTO;
  quote: AssetDetailDTO["quote"];
  held: boolean;
  custom?: AssetDetailDTO["custom"];
  readout?: ChartReadout | null;
  basisMismatch?: BasisFindingDTO | null;
}) {
  const shown =
    readout?.close != null
      ? { amount: String(readout.close), currency: readout.currency }
      : (quote?.price ?? null);
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-6">
      <div className="flex min-w-0 items-start gap-4">
        <CompanyLogo website={profile.website} symbol={profile.symbol} size={48} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-title font-semibold tracking-[-0.03em]">
              {profile.symbol}
              {basisMismatch && (
                <BasisMismatchMark symbol={profile.symbol} finding={basisMismatch} />
              )}
            </h1>
            {custom ? (
              <Chip variant="outline">
                {HOLDING_TYPE_LABELS[custom.holdingType] ?? custom.holdingType}
              </Chip>
            ) : (
              <Chip variant="outline">{profile.assetType}</Chip>
            )}
            {held && <Chip tone="primary">In portfolio</Chip>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{profile.name}</p>
          {custom && (
            <Link
              href={`/custom-holding/${encodeURIComponent(profile.symbol)}/edit`}
              className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground"
            >
              Edit
            </Link>
          )}
        </div>
      </div>
      {shown && (
        <div className="text-right">
          <div className="hero-num">{formatMoney(shown)}</div>
          {readout && <ChartReadoutLine readout={readout} />}
          {quote && readout?.date == null && (
            <div className="mt-1 text-xs text-muted-foreground">
              As of {formatDate(quote.asOf, { year: "always" })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
