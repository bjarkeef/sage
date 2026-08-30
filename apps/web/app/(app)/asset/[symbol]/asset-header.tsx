import Link from "next/link";
import { Chip } from "@sage/ui";
import { CompanyLogo } from "../../../../components/company-logo";
import { formatMoney, formatDate } from "../../../../lib/format";
import type { AssetProfileDTO, AssetDetailDTO } from "../../../../lib/types";

const HOLDING_TYPE_LABELS: Record<string, string> = {
  savings: "Savings account",
  pension: "Pension",
  other: "Other",
};

/** Identity + the page's one hero numeral (the live price). */
export function AssetHeader({
  profile,
  quote,
  held,
  custom,
}: {
  profile: AssetProfileDTO;
  quote: AssetDetailDTO["quote"];
  held: boolean;
  custom?: AssetDetailDTO["custom"];
}) {
  return (
    <div className="mb-8 flex items-start justify-between gap-6">
      <div className="flex items-start gap-4">
        <CompanyLogo website={profile.website} symbol={profile.symbol} size={48} />
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-title font-semibold tracking-[-0.03em]">
              {profile.symbol}
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
      {quote && (
        <div className="text-right">
          <div className="hero-num">{formatMoney(quote.price)}</div>
          <div className="mt-1 text-xs text-muted-foreground">As of {formatDate(quote.asOf)}</div>
        </div>
      )}
    </div>
  );
}
