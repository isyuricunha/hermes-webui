import { QueryClient } from '@tanstack/react-query';

/**
 * Single shared QueryClient (Phase 1 auth): the router's beforeLoad guards
 * and the UI read the same cache, so an auth-state fetch made during
 * navigation is reused by the components — one request per window, not one
 * per consumer.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
