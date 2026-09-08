import type { PositionDTO } from "../../lib/types";
import { formatMoney, formatPercent } from "../../lib/format";
import { CompanyLogo } from "../company-logo";

/** One-line position row for a room: logo, symbol + name, day change, market value. */
export function PositionLine({ position: p }: { position: PositionDTO }) {
  const changeTone =
    p.dailyChangePercent == null
      ? "text-muted-foreground"
      : p.dailyChangePercent > 0
        ? "text-gain"
        : p.dailyChangePercent < 0
          ? "text-loss"
          : "text-muted-foreground";

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5">
      <CompanyLogo website={p.website} symbol={p.symbol} size={28} />
      <div className="min-w-0">
        <div className="truncate font-medium" data-testid="holding-symbol">
          {p.symbol}
        </div>
        {p.name !== p.symbol && (
          <div className="truncate text-xs text-muted-foreground">{p.name}</div>
        )}
      </div>
      <div className="text-right">
        <div className="whitespace-nowrap font-mono text-data tabular-nums">
          {p.marketValue ? formatMoney(p.marketValue) : "—"}
        </div>
        <div className={`whitespace-nowrap text-xs tabular-nums ${changeTone}`}>
          {p.dailyChangePercent != null ? `${formatPercent(p.dailyChangePercent)} today` : "—"}
        </div>
      </div>
    </div>
  );
}
