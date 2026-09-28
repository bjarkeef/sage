"use client";

import * as React from "react";

const TAU_MS = 140;

/**
 * The overview's lead figure rolls toward its target while the reader pans —
 * the one figure DESIGN.md lets move under a moving pointer. It starts at its
 * true value (never counts up from zero) and writes straight to the DOM, so a
 * roll never re-renders the page.
 */
export function useRollingNumber(target: number, enabled: boolean, format: (n: number) => string) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const shown = React.useRef(target);
  const raf = React.useRef<number | null>(null);

  React.useEffect(() => {
    const write = () => {
      if (ref.current) ref.current.textContent = format(shown.current);
    };
    if (!enabled) {
      shown.current = target;
      write();
      return;
    }
    let last = 0;
    const step = (now: number) => {
      const dt = Math.min(48, last ? now - last : 16);
      last = now;
      shown.current += (target - shown.current) * (1 - Math.exp(-dt / TAU_MS));
      if (Math.abs(target - shown.current) < 0.005) shown.current = target;
      write();
      raf.current = shown.current === target ? null : requestAnimationFrame(step);
    };
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [target, enabled, format]);

  return ref;
}
