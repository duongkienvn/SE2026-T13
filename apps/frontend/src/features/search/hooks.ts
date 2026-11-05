import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { useAuthSession } from '../auth/auth-session-context';
import { globalSearch, type SearchView } from './api';
import { refreshSearch, searchKey } from './cache';
import { isApiError } from '../../lib/api-client';

export function useSearch(
  input: string,
  type: 'all' | SearchView,
  page: number,
) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const normalized = input.trim();
  const [debounced, setDebounced] = useState(normalized);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(normalized), 250);
    return () => clearTimeout(timeout);
  }, [normalized]);
  useEffect(() => {
    return () => {
      void client.cancelQueries({ queryKey: searchKey });
    };
  }, [client, normalized, type]);
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'invalidate')
          return;
        const domain = event.query.queryKey[0];
        if (domain === 'boards' || domain === 'workspaces')
          refreshSearch(client);
      }),
    [client],
  );
  const valid = normalized.length > 0 && [...normalized].length <= 120;
  const ready = valid && normalized === debounced && !!user;
  const count = type === 'all' ? 1 : page;
  const queries = useQueries({
    queries: Array.from({ length: count }, (_, index) => {
      const currentPage = index + 1;
      const limit = type === 'all' ? 5 : 20;
      return {
        queryKey: [
          ...searchKey,
          user?.id,
          scope.generation,
          debounced,
          type,
          currentPage,
          limit,
        ],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          runAuthorized((token) =>
            globalSearch(
              token,
              type === 'all'
                ? { q: debounced, type }
                : { q: debounced, type, page: currentPage },
              signal,
            ),
          ),
        enabled: ready,
        gcTime: 0,
        retry: false,
        networkMode: 'always' as const,
        refetchOnMount: 'always' as const,
        refetchOnWindowFocus: 'always' as const,
        refetchOnReconnect: 'always' as const,
      };
    }),
  });
  const fetching = queries.some((query) => query.isFetching);
  const error = ready
    ? queries.find((query) => query.isError)?.error
    : undefined;
  const accessDenied = queries.some(
    (query) =>
      isApiError(query.error) && [401, 403, 404].includes(query.error.status),
  );
  useEffect(() => {
    if (!accessDenied || !scope.isCurrent()) return;
    const key = [...searchKey, user?.id, scope.generation];
    // Retain the error for Retry, but never revive a denied snapshot on Retry.
    void client.cancelQueries({ queryKey: key });
    for (const query of client.getQueryCache().findAll({ queryKey: key }))
      query.setState({ data: undefined });
  }, [accessDenied, client, scope, user?.id]);
  // Do not expose previous results while input or authorization is changing.
  const data =
    ready && scope.isCurrent() && !accessDenied
      ? queries
          .map((query) => query.data)
          .filter((result) => result !== undefined)
      : [];
  return {
    data,
    error,
    loading:
      valid && (!ready || fetching || queries.some((query) => query.isPending)),
    retry: () => queries.forEach((query) => void query.refetch()),
    tooLong: [...normalized].length > 120,
  };
}
