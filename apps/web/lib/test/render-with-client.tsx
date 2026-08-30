import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@sage/ui";
import { makeQueryClient } from "../query/client";

/** A QueryClient with production defaults (incl. staleTime) but retries off,
 *  so "served from cache without refetch" assertions are deterministic and
 *  stay in lockstep with makeQueryClient() if its defaults change. */
export function makeTestQueryClient() {
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  return client;
}

/** Renders a component tree with a fresh, retry-disabled QueryClient so tests
 *  are deterministic. Returns the client so tests can seed/inspect the cache.
 *
 *  Mirrors `app/providers.tsx`: anything calling `useToast()` throws without a
 *  ToastProvider above it, and a test harness that omits a provider the real
 *  app always has just fails for a reason the app never hits. */
export function renderWithClient(
  ui: ReactElement,
  client?: QueryClient,
): RenderResult & { queryClient: QueryClient } {
  const queryClient =
    client ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  const result = render(ui, { wrapper });
  return Object.assign(result, { queryClient });
}
