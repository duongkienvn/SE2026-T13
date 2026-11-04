import type {
  NotificationPreferences,
  NotificationResponse,
} from '@kanban/shared';

const boardId = '10000000-0000-4000-8000-000000000004';
const cardId = '10000000-0000-4000-8000-000000000005';

/** The P4-03 handoff example item; override fields per test. */
export function notificationItem(
  extra: Partial<NotificationResponse> = {},
): NotificationResponse {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    kind: 'CARD_ASSIGNED',
    createdAt: '2026-11-03T10:00:00.000Z',
    readAt: null,
    actor: { id: '10000000-0000-4000-8000-000000000002', displayName: 'Linh' },
    summary: 'You were assigned to "Review onboarding copy"',
    context: {
      workspaceId: '10000000-0000-4000-8000-000000000003',
      boardId,
      cardId,
    },
    target: { kind: 'card', path: `/boards/${boardId}/cards/${cardId}` },
    isUnavailable: false,
    ...extra,
  };
}

export const unavailableItem = (
  extra: Partial<NotificationResponse> = {},
): NotificationResponse => ({
  ...notificationItem(),
  id: '10000000-0000-4000-8000-0000000000ff',
  actor: null,
  summary: 'This notification is no longer available',
  context: null,
  target: null,
  isUnavailable: true,
  ...extra,
});

export const defaultNotificationPreferences: NotificationPreferences = {
  inApp: {
    cardAssigned: true,
    commentMentioned: true,
    workspaceInvited: true,
    boardInvited: true,
    membershipChanged: true,
    dueReminder: true,
  },
  email: { cardAssigned: false, commentMentioned: false, dueReminder: false },
};

export function notificationPage(
  items: NotificationResponse[],
  { page = 1, limit = 20, total = items.length } = {},
) {
  return {
    status: 200,
    body: {
      success: true,
      statusCode: 200,
      message: 'OK',
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: total ? Math.ceil(total / limit) : 0,
      },
    },
  };
}
