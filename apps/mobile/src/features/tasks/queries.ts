import { infiniteQueryOptions } from '@tanstack/react-query';
import type { MyTasksResponse } from '@kanban/shared';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import {
  deduplicatePages,
  nextPage,
} from '../../infrastructure/query/pagination.ts';
import {
  createTasksApi,
  normalizeTaskFilters,
  type TaskFilters,
} from './api.ts';
import { canRetryWorkspace } from '../workspaces/status.ts';

export function tasksOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  filters: TaskFilters,
  timeZone: string,
) {
  const normalized = normalizeTaskFilters(filters);
  const queryKey = [
    ...queryKeys.tasks(identity),
    normalized,
    timeZone,
  ] as const;
  return infiniteQueryOptions({
    queryKey,
    initialPageParam: 1,
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    refetchOnReconnect: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    getNextPageParam: (page: MyTasksResponse) => nextPage(page.meta),
    async queryFn({ pageParam, signal }) {
      try {
        return await createTasksApi(data.api, identity).list(
          filters,
          pageParam,
          signal,
        );
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof ApiError &&
          [403, 404].includes(error.status)
        )
          data.evict(identity, [queryKeys.tasks(identity)]);
        throw error;
      }
    },
  });
}

export function taskCollection<T extends { id: string }>(
  pages: readonly { data: readonly T[] }[],
) {
  return deduplicatePages(pages.map((page) => page.data));
}
