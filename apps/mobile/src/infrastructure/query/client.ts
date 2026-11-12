import { QueryClient } from '@tanstack/react-query';

export function createMobileQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      // Execute once and report offline immediately; never silently queue a write.
      mutations: { retry: false, networkMode: 'always', gcTime: 0 },
    },
  });
}
