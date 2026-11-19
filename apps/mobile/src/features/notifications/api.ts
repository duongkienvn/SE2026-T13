import type { NotificationResponse } from '@kanban/shared';
import { ApiError, invalidResponse } from '../../infrastructure/api/errors.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { requirePage } from '../../infrastructure/query/pagination.ts';
import {
  decodeCount,
  decodeList,
  decodeNotification,
  decodeReadAll,
  notificationId,
} from './decoder.ts';
export type InboxFilter = 'all' | 'unread';
export const inboxLimit = 20;
export function createInboxApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
) {
  const options = (signal: AbortSignal) => ({
    identity,
    signal,
    resourceKey: queryKeys.notifications(identity),
    expectedStatus: 200,
    retries: 0 as const,
  });
  return {
    async list(
      filter: InboxFilter,
      page: number,
      signal: AbortSignal,
      onProof?: (id: string, proof: string) => void,
    ) {
      if (
        !['all', 'unread'].includes(filter) ||
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger((page - 1) * inboxLimit)
      )
        throw new ApiError('configuration');
      const result = requirePage(
        await api.envelope(
          '/notifications',
          (value) => {
            const rows = decodeList(value);
            if (onProof && Array.isArray(value))
              value.forEach((row) => decodeNotification(row, onProof));
            return rows;
          },
          {
            ...options(signal),
            resourceKey: queryKeys.notificationList(identity, {
              filter,
              limit: inboxLimit,
            }),
            query: { filter, page, limit: inboxLimit },
          },
        ),
      );
      const meta = result.meta;
      if (
        meta.page !== page ||
        meta.limit !== inboxLimit ||
        meta.totalPages !== Math.ceil(meta.total / inboxLimit) ||
        result.data.length !==
          Math.min(
            inboxLimit,
            Math.max(0, meta.total - (page - 1) * inboxLimit),
          ) ||
        (filter === 'unread' && result.data.some((row) => row.readAt !== null))
      )
        throw invalidResponse(200);
      return result;
    },
    count: (signal: AbortSignal) =>
      api.json('/notifications/unread-count', decodeCount, {
        ...options(signal),
        resourceKey: queryKeys.unreadCount(identity),
      }),
    read: (id: string, signal: AbortSignal): Promise<NotificationResponse> => {
      const canonicalId = notificationId(id);
      return api.json(
        '/notifications/' + canonicalId + '/read',
        (value) => {
          const result = decodeNotification(value);
          if (result.id !== canonicalId || result.readAt === null)
            throw invalidResponse(200);
          return result;
        },
        { ...options(signal), method: 'PATCH' },
      );
    },
    readAll: (signal: AbortSignal) =>
      api.json('/notifications/read-all', decodeReadAll, {
        ...options(signal),
        method: 'POST',
      }),
  };
}
export type InboxPage = Awaited<
  ReturnType<ReturnType<typeof createInboxApi>['list']>
>;
