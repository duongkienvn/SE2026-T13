import { BoardRole, WorkspaceRole } from '@kanban/shared';
import { workspaceId } from '../decoder.ts';

function invalid(): never {
  throw new Error('Invalid Workspace collaboration response');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}

const id = (value: unknown) => workspaceId(value) ?? invalid();
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : invalid();
const flag = (value: unknown) =>
  typeof value === 'boolean' ? value : invalid();

function avatar(value: unknown) {
  if (value === null) return null;
  return text(value);
}

function instant(value: unknown) {
  const valueText = text(value);
  const date = new Date(valueText);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== valueText)
    return invalid();
  return valueText;
}

export function decodeMember(value: unknown) {
  const row = object(value);
  const { role, avatarRevision } = row;
  if (
    (role !== WorkspaceRole.ADMIN && role !== WorkspaceRole.MEMBER) ||
    typeof avatarRevision !== 'number' ||
    !Number.isSafeInteger(avatarRevision) ||
    avatarRevision < 0
  )
    return invalid();
  return {
    userId: id(row.userId),
    displayName: text(row.displayName),
    avatarUrl: avatar(row.avatarUrl),
    avatarRevision,
    role,
    joinedAt: instant(row.joinedAt),
  };
}

export function decodeGuest(value: unknown) {
  const row = object(value);
  const user = object(row.user);
  if (
    !Array.isArray(row.boards) ||
    !row.boards.length ||
    row.visibleBoardCount !== row.boards.length
  )
    return invalid();
  const boards = row.boards.map((value: unknown) => {
    const board = object(value);
    const { role } = board;
    if (role !== BoardRole.OWNER && role !== BoardRole.MEMBER) return invalid();
    return {
      boardId: id(board.boardId),
      name: text(board.name),
      role,
      isArchived: flag(board.isArchived),
    };
  });
  if (new Set(boards.map(({ boardId }) => boardId)).size !== boards.length)
    return invalid();
  return {
    user: {
      id: id(user.id),
      displayName: text(user.displayName),
      avatarUrl: avatar(user.avatarUrl),
    },
    boards,
    visibleBoardCount: boards.length,
  };
}

export const policyFields = [
  'boardCreationAdminOnly',
  'boardInvitesEnabled',
  'boardMembershipChangesEnabled',
  'boardVisibilityChangesEnabled',
] as const;
export type WorkspacePolicies = Record<(typeof policyFields)[number], boolean>;

export function decodePolicies(value: unknown) {
  const row = object(value);
  return {
    boardCreationAdminOnly: flag(row.boardCreationAdminOnly),
    boardInvitesEnabled: flag(row.boardInvitesEnabled),
    boardMembershipChangesEnabled: flag(row.boardMembershipChangesEnabled),
    boardVisibilityChangesEnabled: flag(row.boardVisibilityChangesEnabled),
    canManagePolicies: flag(row.canManagePolicies),
    canCreateBoards: flag(row.canCreateBoards),
  } satisfies WorkspacePolicies & {
    canManagePolicies: boolean;
    canCreateBoards: boolean;
  };
}

export type WorkspaceMember = ReturnType<typeof decodeMember>;
export type WorkspaceGuest = ReturnType<typeof decodeGuest>;
export type WorkspacePolicy = ReturnType<typeof decodePolicies>;
