import { USER_A } from '../auth/support.ts';
import { board, uuid, workspace } from '../workspaces/fixtures.ts';
import type { BoardRole } from '@kanban/shared';

export const workspaceId = uuid(1);
export const boardId = uuid(1001);
export const activityBoard = () => ({
  ...board(workspaceId),
  createdById: USER_A,
  currentUserRole: null as BoardRole | null,
  archivedAt: null as string | null,
});
export const activityWorkspace = () => workspace();
export const workspaceEvent = (index = 0) => ({
  id: uuid(10000 - index),
  eventType: 'WORKSPACE_UPDATED',
  createdAt: new Date(Date.UTC(2026, 10, 18, 10) - index * 1000).toISOString(),
  actor: { id: USER_A, displayName: 'Verified actor', avatarUrl: null },
  board: null,
});
export const boardEvent = (index = 0) => ({
  id: uuid(10000 - index),
  boardId,
  actorId: USER_A,
  actionType: 'CARD_UPDATED',
  entityType: 'CARD',
  entityId: uuid(3001),
  metadata: null,
  createdAt: workspaceEvent(index).createdAt,
});
