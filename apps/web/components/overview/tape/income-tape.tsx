"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { IncomeStreamPointDTO } from "../../../lib/types";
import { getGoal } from "../../../lib/api";
import { qk } from "../../../lib/query/keys";
import { isoToDay, toTapePoints, yearOfDay, type TapePoint } from "../../../lib/income-tape/points";
import { EDGE_PX, extentOf, fitView, windowOf, type View } from "../../../lib/income-tape/viewport";
import {
  inViewRange,
  resolveRange,
  yearStepBounds,
  type RangeKey,
} from "../../../lib/income-tape/ranges";
import {
  ghostOf,
  indexBySymbol,
  isPartialYear,
  measureTotals,
  monthTotals,
  payerSummary,
  rankPayers,
  yearTotals,
} from "../../../lib/income-tape/aggregates";
import { goalMark } from "../../../lib/income-tape/goal-line";
import { useElementSize } from "./use-element-size";
import { useMotionEnabled } from "./use-motion-enabled";
import { useTapeMotion } from "./use-tape-motion";
import { TapeChart, worldTransform } from "./tape-chart";
import { TapeHud } from "./tape-hud";
import { RangeControl } from "./range-control";
import { PayerChips } from "./payer-chips";
import { FocusCard } from "./focus-card";
import { HoverReadout } from "./hover-readout";
import { YearRibbon } from "./year-ribbon";
import { barHeight, barWidth, baseline } from "./geometry";

export const TAPE_HEIGHT = "max(374px, calc((100vh - 389px) * 0.85))";
const DRAG_THRESHOLD_PX = 3;
const FLING_WINDOW_MS = 80;
const LINE_MODE_PX = 32;
const EMPTY_TOTALS = { total: 0, paid: 0, confirmed: 0, estimated: 0, count: 0 };

/** The payment closest to `day` within `maxDays`; `points` are sorted by day. */
function nearest(points: TapePoint[], day: number, maxDays: number): TapePoint | null {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.day < day) lo = mid + 1;
    else hi = mid;
  }
  let best: TapePoint | null = null;
  let bd = maxDays;
  for (let i = Math.max(0, lo - 3); i <= Math.min(points.length - 1, lo + 3); i++) {
    const d = Math.abs(points[i]!.day - day);
    if (d <= bd) {
      bd = d;
      best = points[i]!;
    }
  }
  return best;
}

interface Press {
  x: number;
  t: number;
  moved: boolean;
  hover: TapePoint | null;
  vel: number;
}

/**
 * The overview's hero: every dividend on one pannable day axis. Opens on Today
 * (the next 12 months); a drag, a sideways or shift + wheel, or ← → leaves the
 * named range and the HUD measures what is in view instead.
 */
export function IncomeTape({
  points: raw,
  todayISO,
  taxRate,
  currency,
  motionPref,
  names,
  brief,
}: {
  points: IncomeStreamPointDTO[];
  todayISO: string;
  taxRate: number | null;
  currency: string;
  motionPref: boolean;
  /** symbol → company name, for the focus card */
  names: Map<string, string>;
  brief?: React.ReactNode;
}) {
  const motionOn = useMotionEnabled(motionPref);
  const todayDay = isoToDay(todayISO);
  const thisYear = yearOfDay(todayDay);
  const points = React.useMemo(() => toTapePoints(raw, taxRate), [raw, taxRate]);
  const index = React.useMemo(() => indexBySymbol(points), [points]);
  const extent = React.useMemo(() => extentOf(points, todayDay), [points, todayDay]);
  const bounds = yearStepBounds(extent);

  const { ref: stageRef, width, height } = useElementSize<HTMLDivElement>();
  const [range, setRange] = React.useState<RangeKey | null>("today");
  const [year, setYear] = React.useState(thisYear);
  const [focus, setFocus] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<TapePoint | null>(null);
  const [entering, setEntering] = React.useState(motionOn);
  // `motionOn` starts true until the reduced-motion query is read; once motion is
  // off the entrance is over at once — off means instant, never slower.
  const enteringNow = entering && motionOn;
  const ctx = React.useMemo(() => ({ todayDay, year, extent }), [todayDay, year, extent]);

  // Only the first width matters here; the stage is re-fitted once measured.
  const [initial] = React.useState<View>(() => {
    const r = resolveRange("today", ctx);
    return fitView(r.view[0], r.view[1], Math.max(width, 2 * EDGE_PX + 1));
  });
  const motion = useTapeMotion(Math.max(width, 2 * EDGE_PX + 1), extent, motionOn, initial);
  const [live, setLive] = React.useState<[number, number]>(() => resolveRange("today", ctx).view);
  const worldRef = React.useRef<SVGGElement | null>(null);

  // Re-fit the active range whenever the stage is measured or resized.
  React.useEffect(() => {
    if (width === 0) return;
    if (range) {
      const r = resolveRange(range, ctx);
      motion.jump(fitView(r.view[0], r.view[1], width));
    }
    // A resize re-fits; a range change animates through `pick` instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  React.useEffect(() => {
    if (!entering) return;
    const t = setTimeout(() => setEntering(false), 900);
    return () => clearTimeout(t);
  }, [entering]);

  // Every frame: pan the drawn world, and track the window the HUD measures when panned.
  // The chart's geometry is drawn at the rendered view's zoom; `motion` changes with it.
  const geomPpd = motion.view.pxPerDay;
  React.useEffect(
    () =>
      motion.onFrame((v) => {
        worldRef.current?.setAttribute("transform", worldTransform(v, extent, geomPpd));
        if (width === 0) return;
        const [a, b] = windowOf(v, width);
        const w: [number, number] = [Math.round(a), Math.round(b)];
        setLive((p) => (p[0] === w[0] && p[1] === w[1] ? p : w));
      }),
    [motion, extent, width, geomPpd],
  );

  const pick = (key: RangeKey, y = year) => {
    const nextYear = key === "today" ? thisYear : y;
    setRange(key);
    setYear(nextYear);
    const r = resolveRange(key, { ...ctx, year: nextYear });
    motion.setTarget(fitView(r.view[0], r.view[1], width));
  };
  const leaveRange = React.useCallback(() => setRange((r) => (r ? null : r)), []);
  const toggleFocus = React.useCallback((symbol: string) => {
    setHover(null);
    setFocus((f) => (f === symbol ? null : symbol));
  }, []);

  // Keyboard: ← → pan a month, Esc clears focus. Arrows never while a control has focus.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFocus(null);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, button, [role=radio], [contenteditable]")) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        leaveRange();
        motion.panBy((e.key === "ArrowRight" ? 30 : -30) * motion.viewRef.current.pxPerDay, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [motion, leaveRange]);

  // Wheel: a native listener, because React's is passive and cannot preventDefault.
  // The vertical wheel is the page's; only a sideways gesture or shift + wheel pans.
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!sideways && !e.shiftKey) return;
      const d = sideways ? e.deltaX : e.deltaY;
      e.preventDefault();
      leaveRange();
      motion.panBy((e.deltaMode === 1 ? d * LINE_MODE_PX : d) * 1.1, true);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [motion, stageRef, leaveRange]);

  // Pointer: a press that moves more than 3px is a drag; one that does not is a click.
  const press = React.useRef<Press | null>(null);
  const hoverAt = (clientX: number) => {
    const el = stageRef.current;
    if (!el || enteringNow) return;
    const v = motion.viewRef.current;
    const day = v.leftDay + (clientX - el.getBoundingClientRect().left) / v.pxPerDay;
    const reach = Math.max(10, barWidth(v.pxPerDay) * 2) / v.pxPerDay;
    const p = nearest(points, day, reach);
    setHover((h) => (h === p ? h : p));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // a right or middle press is not a drag or a click
    // Capture now, so the release is seen even when it happens off the stage.
    stageRef.current?.setPointerCapture?.(e.pointerId);
    press.current = { x: e.clientX, t: performance.now(), moved: false, hover, vel: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    let pr = press.current;
    // A press whose release was never seen (button let go off the stage) is
    // stale: drop it rather than let the tape follow a mouse with no button held.
    if (pr && e.buttons === 0) {
      press.current = null;
      if (pr.moved) motion.hold(false);
      pr = null;
    }
    if (!pr) return hoverAt(e.clientX);
    const dx = pr.x - e.clientX;
    if (!pr.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    if (!pr.moved) {
      pr.moved = true;
      setHover(null);
      leaveRange();
      motion.hold(true);
    }
    const now = performance.now();
    const ppd = motion.viewRef.current.pxPerDay;
    pr.vel = 0.8 * pr.vel + 0.2 * (dx / ppd / Math.max(1, now - pr.t));
    pr.x = e.clientX;
    pr.t = now;
    motion.panBy(dx, false);
  };
  const onPointerUp = () => {
    const pr = press.current;
    press.current = null;
    if (!pr) return;
    if (!pr.moved) {
      if (pr.hover) toggleFocus(pr.hover.symbol);
      return;
    }
    motion.hold(false);
    if (performance.now() - pr.t < FLING_WINDOW_MS) motion.fling(pr.vel);
  };

  // Figures: the named range's measure, or the live window once panned.
  const resolved = range ? resolveRange(range, ctx) : inViewRange(live);
  const totals = measureTotals(points, resolved.measure, focus);
  const prev = resolved.compare ? measureTotals(points, resolved.compare, focus) : null;
  const months = React.useMemo(() => monthTotals(points, focus), [points, focus]);
  const ranked = React.useMemo(() => rankPayers(points), [points]);
  const ytotals = React.useMemo(() => yearTotals(points, focus), [points, focus]);
  const years: { year: number; totals: typeof EMPTY_TOTALS; partial: boolean }[] = [];
  for (let y = bounds.min; y <= bounds.max; y++) {
    years.push({
      year: y,
      totals: ytotals.get(y) ?? EMPTY_TOTALS,
      partial: isPartialYear(y, extent),
    });
  }
  const { data: goalView } = useQuery({ queryKey: qk.goal(), queryFn: getGoal });
  const mark = goalMark({
    goal: goalView,
    displayCurrency: currency,
    focused: focus != null,
    years: years.filter((y) => !y.partial).map((y) => ({ year: y.year, total: y.totals.total })),
    currentYearTotal: ytotals.get(thisYear)?.total ?? 0,
  });

  const summary = focus ? payerSummary(points, focus, todayDay) : null;
  const v = motion.viewRef.current;
  const hoverGhost = hover ? ghostOf(hover, index) : null;
  const maxAmount = React.useMemo(() => Math.max(1, ...points.map((p) => p.amount)), [points]);

  return (
    <section>
      <RangeControl
        active={range}
        year={year}
        bounds={bounds}
        onPick={(k) => pick(k)}
        onStepYear={(d) => pick("year", Math.min(bounds.max, Math.max(bounds.min, year + d)))}
      />
      <div className="mt-8">
        <TapeHud
          range={resolved}
          totals={totals}
          prev={prev}
          currency={currency}
          focus={focus}
          motion={motionOn}
          brief={brief}
          aside={
            summary ? (
              <FocusCard
                summary={summary}
                name={names.get(summary.symbol) ?? null}
                currency={currency}
                onClose={() => setFocus(null)}
              />
            ) : undefined
          }
        />
      </div>

      <div className="tape-bleed relative mt-3" style={{ height: TAPE_HEIGHT }}>
        <div
          ref={stageRef}
          role="group"
          aria-label="Income timeline. Drag, shift + wheel or arrow keys to move through time."
          className="absolute inset-0 cursor-grab touch-pan-y select-none overflow-hidden active:cursor-grabbing [mask-image:linear-gradient(90deg,transparent_0,#000_48px,#000_calc(100%-48px),transparent_100%)]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => !press.current && setHover(null)}
        >
          {width > 0 && height > 0 && (
            <TapeChart
              points={points}
              index={index}
              extent={extent}
              todayDay={todayDay}
              view={motion.view}
              width={width}
              height={height}
              focus={focus}
              hover={hover}
              months={months}
              entering={enteringNow}
              worldRef={worldRef}
            />
          )}
        </div>
        {hover && height > 0 && (
          <HoverReadout
            point={hover}
            ghost={hoverGhost}
            currency={currency}
            x={(hover.day - v.leftDay) * v.pxPerDay}
            y={baseline(height) - barHeight(hover.amount, maxAmount, height) - 12}
          />
        )}
      </div>

      <YearRibbon
        years={years}
        inView={resolved.dates}
        currency={currency}
        selectedYear={range === "year" ? year : null}
        goal={mark}
        onPickYear={(y) => pick("year", y)}
      />
      <PayerChips payers={ranked} focus={focus} onPick={toggleFocus} />
    </section>
  );
}
