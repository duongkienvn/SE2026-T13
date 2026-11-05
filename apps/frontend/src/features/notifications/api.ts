import {
  NotificationKind,
  type NotificationPreferences,
  type NotificationReadAllResult,
  type NotificationResponse,
  type NotificationsQuery,
  type NotificationUnreadCount,
  type UpdateNotificationPreferences,
} from '@kanban/shared';
import {
  ApiError,
  ClientErrorCode,
  apiRequest,
  apiRequestPage,
  type Page,
} from '../../lib/api-client';

const kinds = new Set<string>(Object.values(NotificationKind));
export const IN_APP_KEYS = [
  'cardAssigned',
  'commentMentioned',
  'workspaceInvited',
  'boardInvited',
  'membershipChanged',
  'dueReminder',
] as const;
export const EMAIL_KEYS = [
  'cardAssigned',
  'commentMentioned',
  'dueReminder',
] as const;

function invalid(): never {
  throw new ApiError(
    200,
    ClientErrorCode.INVALID_RESPONSE,
    'The server returned an unexpected response.',
  );
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Internal app routes only; a target is never followed off-site. */
export function isInternalPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
  );
}

/**
 * Normalize one item at the trust boundary. An unavailable stub, or an item
 * with an unusable target, keeps no actor, context or link.
 */
export function parseNotification(value: unknown): NotificationResponse {
  const item = value as NotificationResponse | null;
  if (
    !item ||
    typeof item.id !== 'string' ||
    !kinds.has(item.kind) ||
    typeof item.createdAt !== 'string' ||
    (item.readAt !== null && typeof item.readAt !== 'string') ||
    typeof item.summary !== 'string' ||
    typeof item.isUnavailable !== 'boolean'
  )
    invalid();
  if (item.isUnavailable)
    return { ...item, actor: null, context: null, target: null };
  const actor =
    item.actor &&
    typeof item.actor.id === 'string' &&
    typeof item.actor.displayName === 'string'
      ? { id: item.actor.id, displayName: item.actor.displayName }
      : null;
  const target =
    item.target && isInternalPath(item.target.path)
      ? { kind: item.target.kind, path: item.target.path }
      : null;
  return { ...item, actor, target, context: item.context ?? null };
}

export async function listNotifications(
  accessToken: string,
  query: Required<NotificationsQuery>,
  signal?: AbortSignal,
): Promise<Page<NotificationResponse>> {
  const search = new URLSearchParams({
    filter: query.filter,
    page: String(query.page),
    limit: String(query.limit),
  });
  const page = await apiRequestPage<unknown>(`/notifications?${search}`, {
    accessToken,
    signal,
  });
  return { ...page, items: page.items.map(parseNotification) };
}

export async function readUnreadCount(
  accessToken: string,
  signal?: AbortSignal,
): Promise<number> {
  const result = await apiRequest<NotificationUnreadCount>(
    '/notifications/unread-count',
    { accessToken, signal },
  );
  return isCount(result?.count) ? result.count : invalid();
}

export async function markNotificationRead(
  accessToken: string,
  notificationId: string,
): Promise<NotificationResponse> {
  return parseNotification(
    await apiRequest<NotificationResponse>(
      `/notifications/${encodeURIComponent(notificationId)}/read`,
      { accessToken, method: 'PATCH' },
    ),
  );
}

export async function markAllNotificationsRead(
  accessToken: string,
): Promise<number> {
  const result = await apiRequest<NotificationReadAllResult>(
    '/notifications/read-all',
    { accessToken, method: 'POST' },
  );
  return isCount(result?.updatedCount) ? result.updatedCount : invalid();
}

export function parsePreferences(value: unknown): NotificationPreferences {
  const prefs = value as NotificationPreferences | null;
  if (
    !prefs?.inApp ||
    !prefs.email ||
    !IN_APP_KEYS.every((key) => typeof prefs.inApp[key] === 'boolean') ||
    !EMAIL_KEYS.every((key) => typeof prefs.email[key] === 'boolean')
  )
    invalid();
  return {
    inApp: Object.fromEntries(
      IN_APP_KEYS.map((key) => [key, prefs.inApp[key]]),
    ) as unknown as NotificationPreferences['inApp'],
    email: Object.fromEntries(
      EMAIL_KEYS.map((key) => [key, prefs.email[key]]),
    ) as unknown as NotificationPreferences['email'],
  };
}

export async function getNotificationPreferences(
  accessToken: string,
  signal?: AbortSignal,
): Promise<NotificationPreferences> {
  return parsePreferences(
    await apiRequest<NotificationPreferences>(
      '/users/me/notification-preferences',
      { accessToken, signal },
    ),
  );
}

export async function updateNotificationPreferences(
  accessToken: string,
  patch: UpdateNotificationPreferences,
): Promise<NotificationPreferences> {
  return parsePreferences(
    await apiRequest<NotificationPreferences>(
      '/users/me/notification-preferences',
      { accessToken, method: 'PATCH', body: patch },
    ),
  );
}

/** Only the changed recognized boolean leaves; `{}` when nothing changed. */
export function preferencesPatch(
  saved: NotificationPreferences,
  draft: NotificationPreferences,
): UpdateNotificationPreferences {
  const patch: UpdateNotificationPreferences = {};
  for (const key of IN_APP_KEYS)
    if (draft.inApp[key] !== saved.inApp[key])
      patch.inApp = { ...patch.inApp, [key]: draft.inApp[key] };
  for (const key of EMAIL_KEYS)
    if (draft.email[key] !== saved.email[key])
      patch.email = { ...patch.email, [key]: draft.email[key] };
  return patch;
}
