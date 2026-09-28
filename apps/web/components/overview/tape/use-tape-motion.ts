"use client";

import * as React from "react";
import { clampView, type Extent, type View } from "../../../lib/income-tape/viewport";

const TAU_MS = 110;
const FLING_DECAY_PER_16MS = 0.94;
const MIN_FLING = 1e-4; // days per ms

export interface TapeMotion {
  view: View;
  viewRef: React.MutableRefObject<View>;
  jump(v: View): void;
  setTarget(v: View): void;
  panBy(px: number, eased: boolean): void;
  hold(on: boolean): void;
  fling(daysPerMs: number): void;
  onFrame(fn: (v: View) => void): () => void;
}

/**
 * One animation loop for the tape. The view eases toward its target with a
 * frame-rate independent ~110ms time constant; a released drag carries momentum.
 * Subscribers (the SVG transform, the HUD window) hear every frame; React state
 * changes only when the zoom moves or the motion settles, so a pan never
 * re-renders the chart.
 */
export function useTapeMotion(
  width: number,
  extent: Extent,
  enabled: boolean,
  initial: View,
): TapeMotion {
  const cur = React.useRef(initial);
  const tgt = React.useRef(initial);
  const vel = React.useRef(0);
  const held = React.useRef(false);
  const raf = React.useRef<number | null>(null);
  const lastT = React.useRef(0);
  const subs = React.useRef(new Set<(v: View) => void>());
  const rendered = React.useRef(initial);
  const [view, setView] = React.useState(initial);

  const clamp = React.useCallback((v: View) => clampView(v, width, extent), [width, extent]);

  const publish = React.useCallback((settled: boolean) => {
    for (const fn of subs.current) fn(cur.current);
    const r = rendered.current;
    const zoomed = Math.abs(r.pxPerDay - cur.current.pxPerDay) / r.pxPerDay > 0.001;
    if (settled || zoomed) {
      rendered.current = cur.current;
      setView(cur.current);
    }
  }, []);

  const step = React.useCallback(
    (now: number) => {
      const dt = Math.min(48, lastT.current ? now - lastT.current : 16);
      lastT.current = now;
      if (vel.current !== 0) {
        tgt.current = clamp({ ...tgt.current, leftDay: tgt.current.leftDay + vel.current * dt });
        cur.current = tgt.current;
        vel.current *= Math.pow(FLING_DECAY_PER_16MS, dt / 16);
        if (Math.abs(vel.current) < MIN_FLING) vel.current = 0;
      } else if (cur.current !== tgt.current) {
        const k = 1 - Math.exp(-dt / TAU_MS);
        const c = cur.current;
        const t = tgt.current;
        const next = {
          leftDay: c.leftDay + (t.leftDay - c.leftDay) * k,
          pxPerDay: c.pxPerDay + (t.pxPerDay - c.pxPerDay) * k,
        };
        const done =
          Math.abs(t.leftDay - next.leftDay) * t.pxPerDay < 0.25 &&
          Math.abs(t.pxPerDay - next.pxPerDay) / t.pxPerDay < 0.0005;
        cur.current = done ? t : next;
      }
      const settled = !held.current && vel.current === 0 && cur.current === tgt.current;
      publish(settled);
      if (settled) {
        raf.current = null;
        lastT.current = 0;
      } else {
        raf.current = requestAnimationFrame(step);
      }
    },
    [clamp, publish],
  );

  const kick = React.useCallback(() => {
    if (!enabled) {
      vel.current = 0;
      cur.current = tgt.current;
      publish(!held.current);
      return;
    }
    if (raf.current == null) raf.current = requestAnimationFrame(step);
  }, [enabled, publish, step]);

  React.useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  return React.useMemo<TapeMotion>(
    () => ({
      view,
      viewRef: cur,
      jump(v) {
        vel.current = 0;
        tgt.current = cur.current = clamp(v);
        publish(true);
      },
      setTarget(v) {
        vel.current = 0;
        tgt.current = clamp(v);
        kick();
      },
      panBy(px, eased) {
        vel.current = 0;
        const t = tgt.current;
        tgt.current = clamp({ ...t, leftDay: t.leftDay + px / t.pxPerDay });
        if (!eased) {
          cur.current = tgt.current;
          publish(false);
        }
        kick();
      },
      hold(on) {
        held.current = on;
        if (!on) kick();
      },
      fling(v) {
        if (!enabled) return;
        vel.current = v;
        kick();
      },
      onFrame(fn) {
        subs.current.add(fn);
        return () => void subs.current.delete(fn);
      },
    }),
    [view, clamp, kick, publish, enabled],
  );
}
