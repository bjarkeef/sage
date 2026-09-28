"use client";

import { Card } from "@sage/ui";
import type { PayerSummary } from "../../../lib/income-tape/aggregates";
import { formatDate } from "../../../lib/format";

const money = (n: number, ccy: string) => `${ccy} ${Math.round(n).toLocaleString("en-US")}`;

export function FocusCard({
  summary: s,
  name,
  currency,
  onClose,
}: {
  summary: PayerSummary;
  name: string | null;
  currency: string;
  onClose: () => void;
}) {
  return (
    <Card className="relative w-[310px] p-4 text-sm">
      <button
        type="button"
        aria-label="Clear focus"
        onClick={onClose}
        className="absolute right-3 top-2 text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
      <p className="font-mono font-medium">{s.symbol}</p>
      <p className="mb-3 text-xs text-muted-foreground">
        {[name, s.frequency].filter(Boolean).join(" · ")}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Next</dt>
        <dd className="text-right tabular-nums">
          {s.next
            ? `${formatDate(s.next.iso, { year: "always" })} · ${Math.round(s.next.amount).toLocaleString("en-US")} ${s.next.certainty}`
            : "—"}
        </dd>
        <dt className="text-muted-foreground">Last 12 months</dt>
        <dd className="text-right tabular-nums">{money(s.last12, currency)}</dd>
        <dt className="text-muted-foreground">Next 12 months</dt>
        <dd className="text-right tabular-nums">{money(s.next12, currency)}</dd>
        <dt className="text-muted-foreground">Last 12 mo vs prior 12</dt>
        <dd
          className={`text-right tabular-nums ${s.changePct == null ? "" : s.changePct >= 0 ? "text-gain" : "text-loss"}`}
        >
          {s.changePct == null
            ? "new position"
            : `${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(1)}%`}
        </dd>
        <dt className="text-muted-foreground">Share of income</dt>
        <dd className="text-right tabular-nums">
          {s.share == null ? "—" : `${(s.share * 100).toFixed(1)}%`}
        </dd>
      </dl>
    </Card>
  );
}
