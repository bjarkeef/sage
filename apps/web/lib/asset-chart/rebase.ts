import type { ClosePoint, SeriesPoint } from "./range-change";

/** The benchmark's close on each of `dates`, carrying its last known close
 *  forward over days it has no bar; null before its first bar. */
export function alignToDates(dates: string[], bars: ClosePoint[]): (number | null)[] {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const out: (number | null)[] = [];
  let j = -1;
  for (const d of dates) {
    while (j + 1 < sorted.length && sorted[j + 1]!.date <= d) j++;
    out.push(j >= 0 ? sorted[j]!.close : null);
  }
  return out;
}

/**
 * Both lines as percent change from the first day both have a value. The
 * holding's days are the axis; the benchmark is carried onto them. Days before
 * the benchmark's first bar are dropped from both, so the two lines always
 * start together at 0%.
 */
export function rebasePair(
  holding: SeriesPoint[],
  benchmark: ClosePoint[],
): { holding: SeriesPoint[]; benchmark: SeriesPoint[] } | null {
  const aligned = alignToDates(
    holding.map((p) => p.time),
    benchmark,
  );
  const start = aligned.findIndex((v) => v !== null && v !== 0);
  if (start < 0 || holding[start]!.value === 0) return null;

  const h0 = holding[start]!.value;
  const b0 = aligned[start]!;
  const h: SeriesPoint[] = [];
  const b: SeriesPoint[] = [];
  for (let i = start; i < holding.length; i++) {
    const time = holding[i]!.time;
    h.push({ time, value: (holding[i]!.value / h0 - 1) * 100 });
    b.push({ time, value: ((aligned[i] as number) / b0 - 1) * 100 });
  }
  return { holding: h, benchmark: b };
}
