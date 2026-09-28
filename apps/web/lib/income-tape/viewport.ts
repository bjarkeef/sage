import type { TapePoint } from "./points";

/** Both ends of the tape fade over this many pixels. "In view" is the clear
 *  area between the fades, and every range fits into it, so a range's edge is
 *  never half-faded. */
export const EDGE_PX = 48;
/** Closest zoom: a week is ~56px, enough for a label per payment. */
export const MAX_PX_PER_DAY = 8;

/** `leftDay` is the day at the stage's left pixel (under the fade). */
export interface View {
  leftDay: number;
  pxPerDay: number;
}

export interface Extent {
  firstDay: number;
  lastDay: number;
}

export function clearWidth(widthPx: number): number {
  return Math.max(1, widthPx - 2 * EDGE_PX);
}

export function fitView(fromDay: number, toDay: number, widthPx: number): View {
  const pxPerDay = clearWidth(widthPx) / Math.max(1, toDay - fromDay);
  return { pxPerDay, leftDay: fromDay - EDGE_PX / pxPerDay };
}

/** The clear area as a half-open day range [from, to). */
export function windowOf(view: View, widthPx: number): [number, number] {
  const from = view.leftDay + EDGE_PX / view.pxPerDay;
  return [from, from + clearWidth(widthPx) / view.pxPerDay];
}

export function clampView(view: View, widthPx: number, extent: Extent): View {
  const span = Math.max(1, extent.lastDay - extent.firstDay);
  const minPpd = clearWidth(widthPx) / span;
  const pxPerDay = Math.min(MAX_PX_PER_DAY, Math.max(minPpd, view.pxPerDay));
  const minLeft = extent.firstDay - EDGE_PX / pxPerDay;
  const maxLeft = extent.lastDay - (widthPx - EDGE_PX) / pxPerDay;
  const leftDay = Math.min(Math.max(view.leftDay, minLeft), Math.max(minLeft, maxLeft));
  return { pxPerDay, leftDay };
}

/** The pannable span: every point, and always today. An empty book gets a year
 *  either side so the axis still has ground to draw. */
export function extentOf(points: Pick<TapePoint, "day">[], todayDay: number): Extent {
  if (points.length === 0) return { firstDay: todayDay - 365, lastDay: todayDay + 365 };
  return {
    firstDay: Math.min(points[0]!.day, todayDay),
    lastDay: Math.max(points.at(-1)!.day, todayDay),
  };
}
