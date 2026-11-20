import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import {
  deduplicatePages,
  nextPage,
} from '../../infrastructure/query/pagination.ts';
import { canRetryWorkspace } from '../workspaces/status.ts';
import {
  createInboxApi,
  inboxLimit,
  type InboxFilter,
  type InboxPage,
} from './api.ts';
import { guardInboxCooldown, rememberInboxCooldown } from './retry.ts';
const defaults = {
  staleTime: 1000,
  retry: false as const,
  refetchOnMount: 'always' as const,
};
const canWake = ({
  state,
}: {
  state: { error: unknown; errorUpdatedAt: number };
}) => canRetryWorkspace(state.error, state.errorUpdatedAt);
async function read<T>(
  data: MobileDataLayer,
  identity: SessionIdentity,
  lane: 'list' | 'count',
  request: () => Promise<T>,
  signal: AbortSignal,
) {
  guardInboxCooldown(data, identity, lane);
  const current = data.resources.capture(
    queryKeys.notifications(identity),
    false,
  );
  try {
    return await request();
  } catch (error) {
    if (!signal.aborted) {
      current();
      rememberInboxCooldown(data, identity, lane, error);
      if (error instanceof ApiError && error.status === 403)
        data.evict(identity, [queryKeys.notifications(identity)]);
    }
    throw error;
  }
}
export function inboxOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  filter: InboxFilter,
) {
  return infiniteQueryOptions({
    ...defaults,
    queryKey: queryKeys.notificationList(identity, {
      filter,
      limit: inboxLimit,
    }),
    initialPageParam: 1,
    refetchOnWindowFocus: canWake,
    refetchOnReconnect: canWake,
    getNextPageParam: (page: InboxPage) => nextPage(page.meta),
    queryFn: ({ pageParam, signal }): Promise<InboxPage> =>
      read(
        data,
        identity,
        'list',
        () =>
          createInboxApi(data.api, identity).list(filter, pageParam, signal),
        signal,
      ),
  });
}
export function unreadOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  return queryOptions({
    ...defaults,
    queryKey: queryKeys.unreadCount(identity),
    refetchOnWindowFocus: canWake,
    refetchOnReconnect: canWake,
    queryFn: ({ signal }) =>
      read(
        data,
        identity,
        'count',
        () => createInboxApi(data.api, identity).count(signal),
        signal,
      ),
  });
}
export const inboxRows = (pages: readonly InboxPage[]) =>
  deduplicatePages(pages.map(({ data }) => data));
export function pagesChanged(pages: readonly InboxPage[]) {
  return pages.some(
    (page) =>
      page.meta.total !== pages[0]?.meta.total ||
      page.meta.page > Math.max(1, page.meta.totalPages),
  );
}
