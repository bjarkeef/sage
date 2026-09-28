"use client";

import * as React from "react";

const TAU_MS = 140;

/**
 * The overview's lead figure rolls toward its target while the reader pans —
 * the one figure DESIGN.md lets move under a moving pointer. It starts at its
 * true value (never counts up from zero) and writes straight to the DOM, so a
 * roll never re-renders the page.
 *
 * The hook owns the text, not React: render `text` as the span's only child.
 * It is the first value, fixed for the component's life, so a re-render never
 * commits the final figure over a roll in progress; the layout effect writes
 * before the browser paints, so no frame shows the final value and then snaps
 * back. `format` must be stable (module scope), or every render restarts it.
 */
export function useRollingNumber(
  target: number,
  enabled: boolean,
  format: (n: number) => string,
): { ref: (el: HTMLSpanElement | null) => void; text: string } {
  const el = React.useRef<HTMLSpanElement | null>(null);
  const shown = React.useRef(target);
  const raf = React.useRef<number | null>(null);
  const [text] = React.useState(() => format(target));

  // A span that mounts later (the comparison appears only when there is one)
  // starts from the rolled value, not the first render's.
  const ref = React.useCallback(
    (node: HTMLSpanElement | null) => {
      el.current = node;
      if (node) node.textContent = format(shown.current);
    },
    [format],
  );

  React.useLayoutEffect(() => {
    const write = () => {
      if (el.current) el.current.textContent = format(shown.current);
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

  return { ref, text };
}
