import type {
  RetroactiveIncomeRowDTO,
  AnnouncedDividendDTO,
  ProjectedIncomeRowDTO,
  LongRangeIncomeRowDTO,
} from "./types";

/** The three states a calendar payment can be in. `paid` is money that has
 *  arrived, `announced` is declared by the issuer, `projected` is Sage's own
 *  forecast. */
export type CalendarStatus = "paid" | "announced" | "projected";

/** One payment placed on a date. Built by `buildCalendarEvents` from the
 *  three income arrays; lives here so `lib` code can consume it without
 *  importing from a component. */
export interface CalendarEvent {
  /** YYYY-MM-DD — the payment date where known, otherwise the ex-date. */
  date: string;
  symbol: string;
  name: string;
  income: string;
  currency: string;
  type: CalendarStatus;
  estimated?: boolean;
  lowConfidence?: boolean;
  /** Past the 12-month forecast: today's holdings, the dividend grown by
   *  `growthPct` a year (null: not grown). */
  longRange?: boolean;
  growthPct?: number | null;
  amountPerShare: string | null;
  shares: string | null;
  declarationDate: string | null;
  exDate: string;
  recordDate: string | null;
  paymentDate: string | null;
}

/** Turn the three income arrays into calendar events keyed by date.
 *
 *  Lifted out of `DividendCalendarGrid` so the page (year bounds), the grid
 *  (the month view) and the list (its rows) all read one model — three
 *  reimplementations of this mapping is how the list ended up ignoring the
 *  status filters.
 *
 *  `todayIso` is the caller's day key (`YYYY-MM-DD`), never read from the
 *  clock here: a retroactive row whose payment date is still ahead is money
 *  that has not landed, so it is `announced`, not `paid`. */
export function buildCalendarEvents(
  retroactive: RetroactiveIncomeRowDTO[],
  announced: AnnouncedDividendDTO[],
  projected: ProjectedIncomeRowDTO[],
  todayIso: string,
  longRange: LongRangeIncomeRowDTO[] = [],
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  const push = (key: string, event: CalendarEvent) => {
    const list = map.get(key) ?? [];
    list.push(event);
    map.set(key, list);
  };

  for (const r of retroactive) {
    const key = r.paymentDate ?? r.exDate;
    push(key, {
      date: key,
      symbol: r.symbol,
      name: r.name,
      income: r.income,
      currency: r.currency,
      type: key <= todayIso ? "paid" : "announced",
      estimated: r.paymentDateEstimated,
      amountPerShare: r.amountPerShare,
      shares: r.sharesHeld,
      declarationDate: null,
      exDate: r.exDate,
      recordDate: null,
      paymentDate: r.paymentDate,
    });
  }

  for (const a of announced) {
    const key = a.paymentDate ?? a.exDate;
    push(key, {
      date: key,
      symbol: a.symbol,
      name: a.name,
      income: a.income,
      currency: a.currency,
      type: "announced",
      estimated: a.paymentDateEstimated,
      amountPerShare: a.amountPerShare,
      shares: a.shares,
      declarationDate: a.declarationDate,
      exDate: a.exDate,
      recordDate: a.recordDate,
      paymentDate: a.paymentDate,
    });
  }

  const projectedEvent = (p: ProjectedIncomeRowDTO): CalendarEvent => {
    const key = p.paymentDate ?? p.projectedExDate;
    return {
      date: key,
      symbol: p.symbol,
      name: p.name,
      income: p.income,
      currency: p.currency,
      type: "projected",
      estimated: p.paymentDateEstimated,
      lowConfidence: p.confidence === "low",
      amountPerShare: p.amountPerShare,
      shares: p.shares,
      declarationDate: null,
      exDate: p.projectedExDate,
      recordDate: null,
      paymentDate: p.paymentDate,
    };
  };
  for (const p of projected) {
    const event = projectedEvent(p);
    push(event.date, event);
  }
  for (const p of longRange) {
    const event = { ...projectedEvent(p), longRange: true, growthPct: p.growthPct };
    push(event.date, event);
  }

  return map;
}
