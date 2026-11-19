import { infiniteQueryOptions } from '@tanstack/react-query';
import type { GlobalSearchResults, GlobalSearchType } from '@kanban/shared';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { deduplicatePages } from '../../infrastructure/query/pagination.ts';
import { canRetryWorkspace } from '../workspaces/status.ts';
import { createSearchApi } from './api.ts';
import { searchRequest, type SearchGroupName } from './input.ts';

export function nextSearchPage(last: GlobalSearchResults, page: number) {
  if (
    last.type === 'all' ||
    !last.groups[last.type].hasMore ||
    !Number.isSafeInteger(page + 1) ||
    !Number.isSafeInteger(page * 20)
  )
    return undefined;
  return page + 1;
}
export function searchCollection(
  pages: readonly GlobalSearchResults[],
  group: SearchGroupName,
) {
  return deduplicatePages(pages.map((page) => page.groups[group].items));
}
export function searchOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  q: string,
  type: GlobalSearchType,
) {
  const request = searchRequest(q, type);
  return infiniteQueryOptions({
    queryKey: [...queryKeys.search(identity), request] as const,
    initialPageParam: 1,
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    refetchOnReconnect: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    getNextPageParam: (last: GlobalSearchResults, _pages, page) =>
      nextSearchPage(last, page),
    async queryFn({ pageParam, signal }) {
      try {
        return await createSearchApi(data.api, identity).list(
          searchRequest(q, type, type === 'all' ? undefined : pageParam),
          signal,
        );
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof ApiError &&
          [403, 404].includes(error.status)
        )
          data.evict(identity, [queryKeys.search(identity)]);
        throw error;
      }
    },
  });
}
