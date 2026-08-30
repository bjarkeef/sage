"use client";

import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ToastProvider } from "@sage/ui";
import { getQueryClient } from "../lib/query/client";

export function Providers({ children }: { children: ReactNode }) {
  // No useState: getQueryClient() already returns a stable browser singleton,
  // and useState-init would be discarded if the initial render suspends.
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {children}
        {/* Desktop only. The devtools launcher is fixed to a screen corner and
            on a phone it lands on the tab bar; `display: none` on this wrapper
            hides it even though the launcher itself is position-fixed. */}
        {process.env.NODE_ENV === "development" && (
          <div className="hidden md:block">
            <ReactQueryDevtools initialIsOpen={false} />
          </div>
        )}
      </ToastProvider>
    </QueryClientProvider>
  );
}
