"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDividendIncome, getUserSettings } from "./api";
import { qk } from "./query/keys";
import { netFactor, applyDividendTax } from "./dividend-tax";
import type { DividendIncomeDTO } from "./types";

/**
 * The user's single flat dividend tax rate and its net multiplier, read from
 * the already-cached settings query. Every surface that nets a figure goes
 * through this — nothing re-derives the factor from settings itself.
 *
 * Callers MUST gate rendering on `isLoading`. While the settings query is in
 * flight, `rate` is `null` and `taxed` is `false` — indistinguishable from "no
 * rate configured" — so a figure rendered from this hook before it settles is
 * a WRONG figure (gross, mislabeled as the user's true no-rate state), not
 * merely an early one. Rendering through the loading window means a user with
 * a configured rate briefly sees a gross number captioned as if none were set,
 * which then silently flips to net — and if the settings fetch fails outright,
 * it fails open to gross permanently. See the dividend-analytics page for the
 * established OR-the-loading-states pattern to follow.
 */
export function useDividendTaxRate(): {
  rate: number | null;
  factor: number;
  taxed: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: qk.userSettings(),
    queryFn: getUserSettings,
    staleTime: 300_000,
  });
  const rate = data?.dividendTaxRate ?? null;
  return { rate, factor: netFactor(rate), taxed: rate != null, isLoading };
}

/**
 * The dividend-income payload, already netted. The wire format stays gross
 * (the Analytics yield card shows gross beside net), so netting happens here —
 * and every dividend surface consumes this rather than `getDividendIncome`
 * directly, so no page can render a gross figure by omission.
 *
 * The rate rides on the payload itself, so this needs no second query.
 *
 * `gross` exposes the same payload BEFORE the transform, alongside `data`.
 * It costs nothing extra — it's what the query already returned — and it
 * exists so callers that need a true gross figure (e.g. the Yield card's
 * "Before tax" slot) can compute it directly from gross data instead of
 * dividing a netted figure by `factor`. That division is unsafe: at a 100%
 * tax rate `factor` is 0 (the settings schema allows exactly that), and
 * `net / factor` becomes `0 / 0 = NaN`.
 */
export function useNetDividendIncome(): {
  data: DividendIncomeDTO | null;
  gross: DividendIncomeDTO | null;
  isLoading: boolean;
  taxed: boolean;
  factor: number;
} {
  const { data, isLoading } = useQuery({
    queryKey: qk.dividendIncome(),
    queryFn: getDividendIncome,
  });
  const rate = data?.dividendTaxRate ?? null;
  const factor = netFactor(rate);
  // Memoized on [data, factor] so every downstream useMemo (yield rows, rhythm
  // rows, upcoming payments, IncomeComposition's groups prop, ...) gets a
  // stable reference across renders instead of a fresh object every time —
  // this hook would otherwise re-run applyDividendTax on every render once a
  // tax rate is set. `applyDividendTax`'s own `factor === 1` early return
  // (identity passthrough) is preserved since it's the function memoized here.
  const netted = useMemo(() => (data ? applyDividendTax(data, factor) : null), [data, factor]);
  return {
    data: netted,
    gross: data ?? null,
    isLoading,
    taxed: rate != null,
    factor,
  };
}
