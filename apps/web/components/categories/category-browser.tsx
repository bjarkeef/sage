"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Card,
  ChartSkeleton,
  Delta,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@sage/ui";
import type { CategoriesViewDTO, CategoryHoldingDTO, CategoryNodeDTO } from "../../lib/types";
import { formatMoney, moneyToNumber } from "../../lib/format";
import type { ResolvedPath } from "../../lib/category-path";
import { CompanyLogo } from "../company-logo";
import { segColor } from "../charts/chart-theme";
import type { DonutRow } from "./allocation-donut";

// /categories is the only route on its side of the app that draws a chart, so
// recharts loads on entry rather than in the shared bundle (docs/CHARTS.md).
const AllocationDonut = dynamic(() => import("./allocation-donut").then((m) => m.AllocationDonut), {
  ssr: false,
  loading: () => <ChartSkeleton className="mx-auto h-[200px] w-[200px]" />,
});

/** One line in the table. `unallocated` is a summary, not a holding: it stands
 *  for everything with no place in the tree, and only ever appears at the
 *  root, where it is the remainder that keeps the level summing to 100%. */
type Row =
  | { kind: "category"; key: string; node: CategoryNodeDTO }
  | { kind: "holding"; key: string; holding: CategoryHoldingDTO }
  | { kind: "unallocated"; key: string; holdings: CategoryHoldingDTO[]; weightPct: number };

function rowsFor(node: CategoryNodeDTO, unallocated: CategoryHoldingDTO[], atRoot: boolean): Row[] {
  const rows: Row[] = [
    ...node.children.map((child): Row => ({ kind: "category", key: child.id, node: child })),
    ...node.holdings.map((h): Row => ({ kind: "holding", key: h.symbol, holding: h })),
  ];
  if (atRoot && unallocated.length > 0) {
    rows.push({
      kind: "unallocated",
      key: "__unallocated",
      holdings: unallocated,
      weightPct: Number(unallocated.reduce((s, h) => s + h.weightPct, 0).toFixed(2)),
    });
  }
  return rows;
}

function donutRow(row: Row): DonutRow {
  switch (row.kind) {
    case "category":
      return {
        id: row.key,
        label: row.node.name,
        actualPct: row.node.actualPct,
        targetPct: row.node.targetPct,
      };
    case "holding":
      return {
        id: row.key,
        label: row.holding.name,
        actualPct: row.holding.weightPct,
        targetPct: row.holding.targetPct,
      };
    case "unallocated":
      return { id: row.key, label: "Unallocated", actualPct: row.weightPct, targetPct: null };
  }
}

/** Actual over target for the level being viewed. An em dash where no target
 *  is set — never 0%, which would read as a deliberate target of nothing. */
function ActualTarget({ actualPct, targetPct }: { actualPct: number; targetPct: number | null }) {
  return (
    <span data-testid="allocation" className="whitespace-nowrap font-mono text-data tabular-nums">
      {actualPct.toFixed(1)}%
      <span className="text-muted-foreground"> / {targetPct != null ? `${targetPct}%` : "—"}</span>
    </span>
  );
}

function Swatch({ index }: { index: number }) {
  return (
    <span
      aria-hidden="true"
      className="h-8 w-0.5 shrink-0 rounded-full"
      style={{ background: segColor(index) }}
    />
  );
}

export function CategoryBrowser({
  data,
  resolved,
  hrefFor,
}: {
  data: CategoriesViewDTO;
  resolved: ResolvedPath;
  /** Link for a given trail — the caller owns the URL shape. */
  hrefFor: (trail: CategoryNodeDTO[]) => string;
}) {
  const { node, trail } = resolved;
  const atRoot = trail.length === 0;
  const rows = rowsFor(node, data.unallocated, atRoot);
  const donutRows = rows.map(donutRow).filter((r) => r.actualPct > 0);

  const levelTargetSum = rows.reduce((sum, row) => {
    const target = donutRow(row).targetPct;
    return target != null ? sum + target : sum;
  }, 0);
  const anyTarget = rows.some((row) => donutRow(row).targetPct != null);

  if (rows.length === 0) {
    return <EmptyState message={atRoot ? "No holdings to show yet." : `${node.name} is empty.`} />;
  }

  return (
    // `min-w-0` on both cells is load-bearing, not defensive tidying: a grid
    // item's default `min-width: auto` refuses to shrink below its content's
    // min-content width, so the table would push the card past the viewport
    // and the page — not the table — would scroll sideways.
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      <Card className="flex min-w-0 flex-col justify-center">
        <AllocationDonut rows={donutRows} title={`Allocation within ${node.name}`} />
        {anyTarget && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Dashed ring is target. Outside it is overweight, inside underweight.
          </p>
        )}
      </Card>

      <Card className="min-w-0">
        <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
          <Breadcrumb trail={trail} hrefFor={hrefFor} />
          {anyTarget && (
            <span
              className={cn(
                "font-mono text-data tabular-nums",
                levelTargetSum > 100 ? "text-loss" : "text-muted-foreground",
              )}
            >
              {levelTargetSum.toFixed(1)}% targeted
            </span>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Gain</TableHead>
              <TableHead className="text-right">Allocation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <BrowserRow
                key={row.key}
                row={row}
                index={index}
                trail={trail}
                hrefFor={hrefFor}
                currency={data.totals.value.currency}
              />
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function Breadcrumb({
  trail,
  hrefFor,
}: {
  trail: CategoryNodeDTO[];
  hrefFor: (trail: CategoryNodeDTO[]) => string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        <li>
          {trail.length === 0 ? (
            <span className="font-medium">Portfolio</span>
          ) : (
            <Link href={hrefFor([])} className="text-muted-foreground hover:text-foreground">
              Portfolio
            </Link>
          )}
        </li>
        {trail.map((node, i) => {
          const isLast = i === trail.length - 1;
          return (
            <li key={node.id} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="text-muted-foreground">
                /
              </span>
              {isLast ? (
                <span className="font-medium">{node.name}</span>
              ) : (
                <Link
                  href={hrefFor(trail.slice(0, i + 1))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {node.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function BrowserRow({
  row,
  index,
  trail,
  hrefFor,
  currency,
}: {
  row: Row;
  index: number;
  trail: CategoryNodeDTO[];
  hrefFor: (trail: CategoryNodeDTO[]) => string;
  currency: string;
}) {
  // A row-wide overlay link keeps the whole line clickable without nesting an
  // anchor around table cells, which is invalid markup.
  const overlay = "after:absolute after:inset-0 after:content-['']";

  if (row.kind === "unallocated") {
    const value = row.holdings.reduce((sum, h) => sum + moneyToNumber(h.value), 0);
    return (
      <TableRow>
        <TableCell>
          <div className="flex items-center gap-3">
            <Swatch index={index} />
            <div className="min-w-0">
              <div className="truncate text-muted-foreground">Unallocated</div>
              <div className="text-xs text-muted-foreground">
                {row.holdings.length} holding{row.holdings.length === 1 ? "" : "s"} · assign in Edit
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right font-mono text-data tabular-nums">
          {formatMoney({ amount: value.toFixed(2), currency })}
        </TableCell>
        <TableCell />
        <TableCell className="text-right">
          <ActualTarget actualPct={row.weightPct} targetPct={null} />
        </TableCell>
      </TableRow>
    );
  }

  if (row.kind === "category") {
    const node = row.node;
    return (
      <TableRow className="relative cursor-pointer">
        <TableCell>
          <div className="flex items-center gap-3">
            <Swatch index={index} />
            <div className="min-w-0">
              <Link href={hrefFor([...trail, node])} className={cn("block truncate", overlay)}>
                {node.name}
              </Link>
              <div className="text-xs text-muted-foreground">
                {node.itemCount} item{node.itemCount === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="font-mono text-data tabular-nums">{formatMoney(node.value)}</div>
          <div className="text-xs text-muted-foreground">{formatMoney(node.invested)} cost</div>
        </TableCell>
        <TableCell className="text-right">
          <Delta value={moneyToNumber(node.gain)} currency={node.value.currency} />
        </TableCell>
        <TableCell className="text-right">
          <ActualTarget actualPct={node.actualPct} targetPct={node.targetPct} />
        </TableCell>
      </TableRow>
    );
  }

  const holding = row.holding;
  return (
    <TableRow className="relative">
      <TableCell>
        <div className="flex items-center gap-3">
          <Swatch index={index} />
          <CompanyLogo website={holding.website} symbol={holding.symbol} size={28} />
          <div className="min-w-0">
            <Link href={`/asset/${holding.symbol}`} className={cn("block truncate", overlay)}>
              {holding.name}
            </Link>
            <div className="font-mono text-xs text-muted-foreground">{holding.symbol}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="font-mono text-data tabular-nums">{formatMoney(holding.value)}</div>
        <div className="text-xs text-muted-foreground">{formatMoney(holding.invested)} cost</div>
      </TableCell>
      <TableCell className="text-right">
        <Delta value={moneyToNumber(holding.gain)} currency={holding.value.currency} />
      </TableCell>
      <TableCell className="text-right">
        <ActualTarget actualPct={holding.weightPct} targetPct={holding.targetPct} />
      </TableCell>
    </TableRow>
  );
}
