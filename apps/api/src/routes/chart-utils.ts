export interface ChartPoint {
  date: string;
  close: { amount: string; currency: string };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function forwardFillChart(points: ChartPoint[]): ChartPoint[] {
  const filtered = points.filter((p) => Number(p.close.amount) > 0);
  if (filtered.length <= 1) return filtered;

  const result: ChartPoint[] = [];

  for (let i = 0; i < filtered.length; i++) {
    result.push(filtered[i]!);

    if (i < filtered.length - 1) {
      let cursor = addDays(filtered[i]!.date, 1);
      const nextDate = filtered[i + 1]!.date;

      while (cursor < nextDate) {
        if (!isWeekend(cursor)) {
          result.push({ date: cursor, close: filtered[i]!.close });
        }
        cursor = addDays(cursor, 1);
      }
    }
  }

  return result;
}
