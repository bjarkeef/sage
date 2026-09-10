"use client";

import Link from "next/link";
import { Delta } from "@sage/ui";
import type { PositionDTO } from "../lib/types";
import { formatMoney, formatPercent, formatShares, moneyToNumber } from "../lib/format";
import { CompanyLogo } from "./company-logo";
import { TransactionDialog } from "./transaction-dialog";
import { toSearchResult } from "../lib/instrument";

const UNAVAILABLE = <span className="text-muted-foreground">unavailable</span>;

/** Shared grid tracks — the readable-row contract requires the header row and
 *  data rows to align on identical columns. Value + Weight collapse on mobile
 *  (hidden md:block on their cells drops them out of the flow). A fifth,
 *  32px track budgets space for the quick-add action; the `sm` icon button it
 *  holds actually renders ~38px, and the overflow is absorbed by the row's
 *  own trailing padding rather than by this track. */
export const HOLDING_ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_170px_32px] items-center gap-3 md:grid-cols-[minmax(0,1fr)_130px_170px_100px_32px]";

/** One holdings row: identity · value/shares · return/today · weight/yield. */
export function HoldingRow({
  position: p,
  groupTotal,
}: {
  position: PositionDTO;
  groupTotal: number;
}) {
  const mv = p.marketValue ? moneyToNumber(p.marketValue) : null;
  const weight = mv != null && groupTotal > 0 ? (mv / groupTotal) * 100 : null;
  const assetHref = `/asset/${p.exchange ? `${p.exchange}-` : ""}${encodeURIComponent(p.symbol)}`;
  const todayTone =
    p.dailyChangePercent == null
      ? "text-muted-foreground"
      : p.dailyChangePercent > 0
        ? "text-gain"
        : p.dailyChangePercent < 0
          ? "text-loss"
          : "text-muted-foreground";

  return (
    <div
      className={`group ${HOLDING_ROW_GRID} rounded-control px-3 py-2 transition-colors hover:bg-surface-hover`}
    >
      <Link href={assetHref} className="flex min-w-0 items-center gap-3">
        <CompanyLogo website={p.website} symbol={p.symbol} size={36} />
        <div className="min-w-0">
          <div data-testid="holding-symbol" className="truncate font-medium group-hover:underline">
            {p.symbol}
            {p.basisMismatch && (
              <span
                role="img"
                aria-label={`Price basis disagrees with your transactions by about ${p.basisMismatch.factor.toFixed(1)}×`}
                title={`Stored prices for ${p.symbol} are about ${p.basisMismatch.factor.toFixed(1)}× apart from your transactions (${p.basisMismatch.mismatched} of ${p.basisMismatch.samples} checked). Figures including it may be wrong.`}
                className="ml-1.5 inline-block size-1.5 rounded-full bg-muted-foreground align-middle"
              />
            )}
          </div>
          {p.name !== p.symbol && (
            <div className="truncate text-xs text-muted-foreground">{p.name}</div>
          )}
        </div>
      </Link>

      <div className="hidden text-right md:block">
        <div className="whitespace-nowrap font-mono text-data tabular-nums">
          {p.marketValue ? formatMoney(p.marketValue) : UNAVAILABLE}
        </div>
        <div className="whitespace-nowrap text-xs text-muted-foreground">
          {formatShares(p.quantity)} sh
        </div>
      </div>

      <div className="whitespace-nowrap text-right">
        {/* Headline is the unrealized price gain on the *current* holding — a
            clean ÷-current-cost-basis figure. Lifetime dividends live on the
            asset page, never folded into this percent: on a sold-down position
            they'd divide by a shrunken basis and read as an unreal %. */}
        {p.unrealizedGainLoss ? (
          <Delta
            value={moneyToNumber(p.unrealizedGainLoss)}
            percent={p.gainLossPercent ?? undefined}
            currency={p.currency}
            className="justify-end font-medium"
          />
        ) : (
          UNAVAILABLE
        )}
        <div className={`text-xs ${todayTone}`}>
          {p.dailyChangePercent != null ? `${formatPercent(p.dailyChangePercent)} today` : "—"}
        </div>
      </div>

      <div className="hidden text-right md:block">
        <div className="whitespace-nowrap font-mono text-data tabular-nums">
          {weight != null ? `${weight.toFixed(1)}%` : "—"}
        </div>
        <div className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
          {p.yieldOnCost != null ? `${(p.yieldOnCost * 100).toFixed(2)}% yld` : "—"}
        </div>
      </div>

      {/* Quick add for a holding you already own. Hidden until hover on
       * pointer devices; always present for touch, which has no hover. */}
      <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <TransactionDialog
          mode="add"
          instrument={toSearchResult({
            symbol: p.symbol,
            name: p.name,
            exchange: p.exchange,
            // nativeCurrency, not currency: the latter is a display choice, and
            // posting a buy or sell in it against lots kept in another currency
            // is refused by the API as a currency_mismatch.
            currency: p.nativeCurrency,
          })}
          triggerVariant="ghost"
          triggerSize="sm"
          triggerIconOnly
        />
      </div>
    </div>
  );
}
