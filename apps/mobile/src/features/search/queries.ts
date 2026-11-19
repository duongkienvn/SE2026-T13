import { infiniteQueryOptions } from '@tanstack/react-query';
import type {
  GlobalSearchItem,
  GlobalSearchResults,
  GlobalSearchType,
} from '@kanban/shared';
import { ApiError } from '../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { MAX_AUTOMATIC_RETRY_DELAY_MS } from '../../infrastructure/api/client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { deduplicatePages } from '../../infrastructure/query/pagination.ts';
import { canRetryWorkspace } from '../workspaces/status.ts';
import { createSearchApi } from './api.ts';
import { searchRequest, type SearchGroupName } from './input.ts';

// One endpoint budget across q/type/page changes, retained across route remounts.
// Only the current session's safe error/deadline is retained; never query text.
const cooldowns = new WeakMap<
  MobileDataLayer,
  { identity: SessionIdentity; error: ApiError; updatedAt: number }
>();
export function searchCooldown(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  const value = cooldowns.get(data);
  return value && sameIdentity(identity, value.identity) ? value : undefined;
}
export function searchPagesChanged(pages: readonly GlobalSearchResults[]) {
  const first = pages[0];
  if (!first || first.type === 'all') return false;
  const type = first.type;
  return pages.some(
    (page) => page.groups[type].total !== first.groups[type].total,
  );
}

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
  return deduplicatePages<GlobalSearchItem>(
    pages.map((page) => page.groups[group].items),
  );
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
    getNextPageParam: (
      last: GlobalSearchResults,
      _pages: GlobalSearchResults[],
      page: number,
    ) => nextSearchPage(last, page),
    async queryFn({ pageParam, signal }): Promise<GlobalSearchResults> {
      data.assertCurrent(identity);
      const current = data.resources.capture(queryKeys.search(identity), false);
      const failure = searchCooldown(data, identity);
      if (failure && !canRetryWorkspace(failure.error, failure.updatedAt)) {
        const delay = Number.isFinite(failure.error.retryAfterMs)
          ? failure.error.retryAfterMs!
          : MAX_AUTOMATIC_RETRY_DELAY_MS;
        throw new ApiError('http', {
          status: 429,
          retryAfterMs: Math.max(0, failure.updatedAt + delay - Date.now()),
        });
      }
      try {
        return await createSearchApi(data.api, identity).list(
          searchRequest(q, type, type === 'all' ? undefined : pageParam),
          signal,
        );
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof ApiError &&
          error.status === 429
        ) {
          data.assertCurrent(identity);
          cooldowns.set(data, { identity, error, updatedAt: Date.now() });
        }
        if (
          !signal.aborted &&
          error instanceof ApiError &&
          [403, 404].includes(error.status)
        ) {
          current();
          data.evict(identity, [queryKeys.search(identity)]);
        }
        throw error;
      }
    },
  });
}
