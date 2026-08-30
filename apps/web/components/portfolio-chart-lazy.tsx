"use client";

import dynamic from "next/dynamic";
import { AmbientChartSkeleton } from "./skeletons";

/** lightweight-charts is sizeable and this chart lives on the landing route, so
 *  it would otherwise sit in the overview's initial client JS. The chart is only
 *  ever drawn client-side (createChart runs in an effect), so ssr:false costs
 *  nothing visually and keeps the library in a deferred chunk fetched after the
 *  page is interactive. */
export const PortfolioChart = dynamic(
  () => import("./portfolio-chart").then((m) => m.PortfolioChart),
  { ssr: false, loading: () => <AmbientChartSkeleton /> },
);
