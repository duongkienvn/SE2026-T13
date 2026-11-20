import type { NotificationResponse } from '@kanban/shared';
export const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const boardId = uuid(10),
  cardId = uuid(11),
  workspaceId = uuid(12);
export const proof = 'A'.repeat(43);
export function notification(
  n = 1,
  patch: Partial<NotificationResponse> = {},
): NotificationResponse {
  return {
    id: uuid(n),
    kind: 'CARD_ASSIGNED',
    createdAt: '2026-11-19T01:00:00.000Z',
    readAt: null,
    actor: { id: uuid(99), displayName: 'Teammate' },
    summary: 'You were assigned to "Design"',
    context: { workspaceId, boardId, cardId },
    target: { kind: 'card', path: `/boards/${boardId}/cards/${cardId}` },
    isUnavailable: false,
    ...patch,
  };
}
export function page(
  rows: NotificationResponse[],
  number = 1,
  total = rows.length,
) {
  return {
    success: true as const,
    statusCode: 200,
    message: 'OK',
    data: rows,
    meta: { page: number, limit: 20, total, totalPages: Math.ceil(total / 20) },
  };
}
