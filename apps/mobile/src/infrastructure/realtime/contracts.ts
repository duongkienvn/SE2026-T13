import {
  RealtimeAccessEvent,
  RealtimeNotificationEvent,
  RealtimePresenceEvent,
  RealtimeServerEvent,
  type BoardRoomAck,
  type RealtimeServerEvents,
} from '@kanban/shared';
import { parseApiBaseUrl } from '../api/config.ts';
import { isUuid } from '../auth/credential-record.ts';

export const SOCKET_PATH = '/socket.io';
export function socketOrigin(
  value: string | undefined,
  development: boolean,
): string | null {
  return parseApiBaseUrl(value, development)?.origin ?? null;
}
export const SERVER_EVENTS = [
  ...Object.values(RealtimeServerEvent),
  ...Object.values(RealtimeAccessEvent),
  RealtimePresenceEvent.SYNC,
  RealtimeNotificationEvent.CHANGED,
] as const;
export type ServerEvent = keyof RealtimeServerEvents;
export interface Hint {
  boardId?: string;
  workspaceId?: string;
  cardId?: string;
  userId?: string;
  userIds?: string[];
  changeScope?: 'card-fields' | 'attachments' | 'checklists';
  operationId?: string;
  retainsReadAccess?: boolean;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate the shared wire shape before using any resource identifier. */
export function parseHint(event: ServerEvent, value?: unknown): Hint | null {
  if (event === 'access:changed') return value === undefined ? {} : null;
  if (!object(value)) return null;
  if (event === 'notifications:changed')
    return Object.keys(value).length === 0 ? {} : null;
  const result: Hint = {};
  const ids =
    event === 'workspace:access-revoked'
      ? ['workspaceId']
      : event === 'presence:sync' || event.startsWith('board:')
        ? ['boardId']
        : event.startsWith('column:')
          ? ['boardId', 'columnId']
          : event.startsWith('member:')
            ? ['boardId', 'userId']
            : event.startsWith('comment:')
              ? ['boardId', 'cardId', 'commentId']
              : event === 'labels:changed'
                ? ['boardId', 'labelId']
                : event === 'card:moved'
                  ? ['boardId', 'cardId', 'fromColumnId', 'toColumnId']
                  : ['boardId', 'cardId', 'columnId'];
  for (const key of ids) {
    if (!isUuid(value[key])) return null;
    if (['boardId', 'workspaceId', 'cardId', 'userId'].includes(key))
      Object.assign(result, { [key]: (value[key] as string).toLowerCase() });
  }
  if (event === 'presence:sync') {
    if (
      !Array.isArray(value.userIds) ||
      value.userIds.length > 10_000 ||
      !value.userIds.every(isUuid)
    )
      return null;
    result.userIds = [
      ...new Set(value.userIds.map((id: string) => id.toLowerCase())),
    ].sort();
  }
  if (value.changeScope !== undefined) {
    if (
      !['card-fields', 'attachments', 'checklists'].includes(
        value.changeScope as string,
      )
    )
      return null;
    result.changeScope = value.changeScope as Hint['changeScope'];
  }
  if (value.operationId !== undefined) {
    if (
      typeof value.operationId !== 'string' ||
      value.operationId.length > 128 ||
      !/^[\w-]+$/.test(value.operationId)
    )
      return null;
    result.operationId = value.operationId;
  }
  if (value.retainsReadAccess !== undefined) {
    if (typeof value.retainsReadAccess !== 'boolean') return null;
    result.retainsReadAccess = value.retainsReadAccess;
  }
  return result;
}

export function parseRoomAck(
  value: unknown,
  boardId: string,
): BoardRoomAck | null {
  if (!object(value)) return null;
  if (value.success === true)
    return value.boardId === boardId ? { success: true, boardId } : null;
  if (
    value.success !== false ||
    ![
      'UNAUTHORIZED',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'TOO_MANY_REQUESTS',
      'INTERNAL_ERROR',
    ].includes(value.code as string)
  )
    return null;
  // Never retain raw server payload/messages in diagnostics.
  return {
    success: false,
    code: value.code as Extract<BoardRoomAck, { success: false }>['code'],
    message: 'Board subscription failed',
  };
}
