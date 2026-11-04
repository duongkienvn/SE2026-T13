import type { QueryClient } from '@tanstack/react-query';

export const notificationsKey = ['notifications'] as const;

/** Every notification query is scoped to the signed-in user and session generation. */
export const notificationKeys = {
  all: notificationsKey,
  session: (userId: string | undefined, generation: number) =>
    [...notificationsKey, userId, generation] as const,
  count: (userId: string | undefined, generation: number) =>
    [...notificationKeys.session(userId, generation), 'count'] as const,
  lists: (userId: string | undefined, generation: number) =>
    [...notificationKeys.session(userId, generation), 'list'] as const,
  list: (
    userId: string | undefined,
    generation: number,
    filter: 'all' | 'unread',
    page: number,
    limit: number,
  ) =>
    [
      ...notificationKeys.lists(userId, generation),
      filter,
      page,
      limit,
    ] as const,
  preferences: (userId: string | undefined, generation: number) =>
    [...notificationKeys.session(userId, generation), 'preferences'] as const,
};

const inbox = {
  queryKey: notificationsKey,
  predicate: (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[3] === 'count' || query.queryKey[3] === 'list',
};

/** Refetch the inbox and unread count; current rows stay until replaced. */
export function refreshNotifications(client: QueryClient) {
  void client.invalidateQueries(inbox);
}

/**
 * Access was lost somewhere: drop rendered summaries and actor names right
 * away, then let REST resolve which items are now unavailable.
 */
export function clearNotificationDetails(client: QueryClient) {
  const lists = {
    queryKey: notificationsKey,
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[3] === 'list',
  };
  if (!client.getQueryCache().findAll(lists).length) return;
  void client.cancelQueries(lists);
  for (const query of client.getQueryCache().findAll(lists))
    query.setState({ data: undefined, status: 'pending', error: null });
  void client.invalidateQueries(inbox);
}

/**
 * Coalesce bursts of `notifications:changed {}` hints into one refetch. The
 * payload is never trusted; REST is the only source of notification data.
 */
export function createNotificationHint(client: QueryClient, delay = 150) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    hint() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        refreshNotifications(client);
      }, delay);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
