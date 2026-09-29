"use client";

import * as React from "react";

/** Motion is on only when the user's setting allows it AND the OS does not ask
 *  for reduced motion. Off means instant, never slower (DESIGN.md, Motion). */
export function useMotionEnabled(pref: boolean): boolean {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return pref && !reduce;
}
