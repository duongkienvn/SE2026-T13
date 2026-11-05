import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NotificationResponse,
  UpdateNotificationPreferences,
} from '@kanban/shared';
import type { Page } from '../../lib/api-client';
import { useAuthSession } from '../auth/auth-session-context';
import { useAuth } from '../auth/useAuth';
import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  readUnreadCount,
  updateNotificationPreferences,
} from './api';
import { notificationKeys, refreshNotifications } from './cache';

/** Authoritative bell badge; never derived from the rows currently loaded. */
export function useUnreadCount() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const query = useQuery({
    queryKey: notificationKeys.count(user?.id, scope.generation),
    queryFn: ({ signal }) =>
      runAuthorized((token) => readUnreadCount(token, signal)),
    enabled: !!user,
    retry: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  return { ...query, count: scope.isCurrent() ? query.data : undefined };
}

export function useNotificationList(
  filter: 'all' | 'unread',
  page: number,
  limit: number,
  enabled = true,
) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const query = useQuery({
    queryKey: notificationKeys.list(
      user?.id,
      scope.generation,
      filter,
      page,
      limit,
    ),
    queryFn: ({ signal }) =>
      runAuthorized((token) =>
        listNotifications(token, { filter, page, limit }, signal),
      ),
    enabled: !!user && enabled,
    retry: false,
    gcTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  return { ...query, page: scope.isCurrent() ? query.data : undefined };
}

/** Idempotent server read; rows show the server's `readAt`, never a guess. */
export function useMarkRead() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      if (!scope.isCurrent()) throw new Error('Session changed');
      return runAuthorized((token) => markNotificationRead(token, id));
    },
    onSuccess: (item) => {
      if (!scope.isCurrent()) return;
      for (const query of client.getQueryCache().findAll({
        queryKey: notificationKeys.lists(user?.id, scope.generation),
      }))
        client.setQueryData<Page<NotificationResponse>>(
          query.queryKey,
          (current) =>
            current && {
              ...current,
              items: current.items.map((row) =>
                // Access may have changed while mark-read was in flight.
                // Only list refetches can replace protected notification details.
                row.id === item.id ? { ...row, readAt: item.readAt } : row,
              ),
            },
        );
      refreshNotifications(client);
    },
  });
}

export function useMarkAllRead() {
  const { runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!scope.isCurrent()) throw new Error('Session changed');
      return runAuthorized((token) => markAllNotificationsRead(token));
    },
    onSuccess: () => {
      if (scope.isCurrent()) refreshNotifications(client);
    },
  });
}

export function useNotificationPreferences() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const query = useQuery({
    queryKey: notificationKeys.preferences(user?.id, scope.generation),
    queryFn: ({ signal }) =>
      runAuthorized((token) => getNotificationPreferences(token, signal)),
    enabled: !!user,
    retry: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  return { ...query, preferences: scope.isCurrent() ? query.data : undefined };
}

export function useUpdateNotificationPreferences() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateNotificationPreferences) => {
      if (!scope.isCurrent()) throw new Error('Session changed');
      return runAuthorized((token) =>
        updateNotificationPreferences(token, patch),
      );
    },
    onSuccess: (result) => {
      if (!scope.isCurrent()) return;
      client.setQueryData(
        notificationKeys.preferences(user?.id, scope.generation),
        result,
      );
    },
  });
}
