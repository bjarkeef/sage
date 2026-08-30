"use client";

import dynamic from "next/dynamic";
import { HeroSkeleton } from "./skeletons";

/** Defers lightweight-charts out of the performance route's initial JS; the
 *  chart renders client-side only, so ssr:false is free. See portfolio-chart-lazy. */
export const PerformanceStudio = dynamic(
  () => import("./performance-studio").then((m) => m.PerformanceStudio),
  { ssr: false, loading: () => <HeroSkeleton /> },
);
