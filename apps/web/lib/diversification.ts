import type { ConstituentDTO, DiversificationDimRowDTO } from "./types";

export type Basis = "market" | "cost";

export interface BucketHoldingRow {
  symbol: string | null;
  name: string;
  /** Display label: "VOO (60.00%)" for x-ray fund slices, "via VOO"/"Direct"
   *  for constituent sources, else the holding name. */
  label: string;
  amount: number;
  percentOfBucket: number;
}

export interface BucketRow {
  label: string;
  amount: number;
  percent: number;
  holdings: BucketHoldingRow[];
}

function amountOf(value: { amount: string }): number {
  return Number(value.amount);
}

function pick(
  row: { marketValue: { amount: string }; costValue: { amount: string } },
  basis: Basis,
): number {
  return amountOf(basis === "market" ? row.marketValue : row.costValue);
}

function pct(part: number, total: number): number {
  return total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0;
}

function finalize(buckets: BucketRow[], total: number): BucketRow[] {
  if (total <= 0) return [];
  for (const bucket of buckets) {
    bucket.percent = pct(bucket.amount, total);
    for (const holding of bucket.holdings) {
      holding.percentOfBucket = pct(holding.amount, bucket.amount);
    }
    bucket.holdings.sort((a, b) => b.amount - a.amount);
  }
  return buckets.sort((a, b) => b.amount - a.amount);
}

export function selectSectorRows(
  sector: { plain: DiversificationDimRowDTO[]; xray: DiversificationDimRowDTO[] },
  xrayOn: boolean,
): DiversificationDimRowDTO[] {
  return xrayOn ? sector.xray : sector.plain;
}

/** Group dimension rows into labeled buckets for one chart. */
export function aggregateDimension(rows: DiversificationDimRowDTO[], basis: Basis): BucketRow[] {
  const buckets = new Map<string, BucketRow>();
  let total = 0;
  for (const row of rows) {
    const amount = pick(row, basis);
    total += amount;
    const bucket = buckets.get(row.bucket) ?? {
      label: row.bucket,
      amount: 0,
      percent: 0,
      holdings: [],
    };
    bucket.amount += amount;
    bucket.holdings.push({
      symbol: row.symbol,
      name: row.name,
      label:
        row.fundWeightPct != null ? `${row.symbol} (${row.fundWeightPct.toFixed(2)}%)` : row.name,
      amount,
      percentOfBucket: 0,
    });
    buckets.set(row.bucket, bucket);
  }
  return finalize([...buckets.values()], total);
}

/** One bucket per holding — the All-holdings card with X-Ray off. Feed it any
 *  single-array dimension: each carries exactly one row per position. */
export function aggregateHoldings(rows: DiversificationDimRowDTO[], basis: Basis): BucketRow[] {
  const buckets: BucketRow[] = [];
  let total = 0;
  for (const row of rows) {
    const amount = pick(row, basis);
    total += amount;
    buckets.push({
      label: row.name,
      amount,
      percent: 0,
      holdings: [
        { symbol: row.symbol, name: row.name, label: row.name, amount, percentOfBucket: 0 },
      ],
    });
  }
  return finalize(buckets, total);
}

/** One bucket per constituent — the All-holdings card with X-Ray on. */
export function aggregateConstituents(constituents: ConstituentDTO[], basis: Basis): BucketRow[] {
  const buckets: BucketRow[] = [];
  let total = 0;
  for (const constituent of constituents) {
    const amount = pick(constituent, basis);
    total += amount;
    buckets.push({
      label: constituent.name,
      amount,
      percent: 0,
      holdings: constituent.sources.map((source) => ({
        symbol: constituent.symbol,
        name: constituent.name,
        label: source.type === "direct" ? "Direct" : `via ${source.fundSymbol ?? "fund"}`,
        amount: pick(source, basis),
        percentOfBucket: 0,
      })),
    });
  }
  return finalize(buckets, total);
}
