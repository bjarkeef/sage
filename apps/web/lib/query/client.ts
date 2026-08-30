import { QueryClient, isServer } from "@tanstack/react-query";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 300_000,
        retry: 1,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) {
    // Server: a fresh client per request so no state leaks between users.
    return makeQueryClient();
  }
  // Browser: reuse one client; recreating it on a suspended initial render
  // would throw away in-flight state.
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
