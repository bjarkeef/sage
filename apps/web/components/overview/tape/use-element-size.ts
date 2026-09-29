"use client";

import * as React from "react";

/** Measured size, so one SVG unit is one CSS pixel and mono labels stay crisp. */
export function useElementSize<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize((s) =>
        s.width === Math.round(r.width) && s.height === Math.round(r.height)
          ? s
          : { width: Math.round(r.width), height: Math.round(r.height) },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}
