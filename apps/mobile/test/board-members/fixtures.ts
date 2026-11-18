import { BoardRole } from '@kanban/shared';
import { board, uuid } from '../workspaces/fixtures.ts';
import { USER_A } from '../auth/support.ts';

export const boardId = USER_A;
export const workspaceId = uuid(1);
export const policy = {
  canInviteMembers: true,
  canChangeMembership: true,
  canChangeVisibility: true,
};
export function membershipBoard(overrides: Record<string, unknown> = {}) {
  return {
    ...board(workspaceId),
    id: boardId,
    createdById: uuid(900),
    name: 'Launch plan',
    currentUserRole: BoardRole.OWNER as BoardRole | null,
    capabilities: {
      canReadBoard: true,
      canWriteBoard: true,
      canManageBoard: true,
      canManageMembers: true,
      canRestoreBoard: false,
    },
    ...overrides,
  };
}
export function member(n = 1, role: BoardRole = BoardRole.MEMBER) {
  const date = '2026-11-15T09:00:00.000Z';
  return {
    id: uuid(5000 + n),
    user: {
      id: uuid(n + 50),
      email: `member${n}@example.test`,
      displayName: `Member ${n}`,
      avatarUrl: null as string | null,
      avatarRevision: 0,
      createdAt: date,
      updatedAt: date,
    },
    role,
    joinedAt: date,
  };
}
export const actor = {
  ...member(99, BoardRole.OWNER),
  user: { ...member(99).user, id: USER_A, displayName: 'Current owner' },
};
