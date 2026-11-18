import { invalidResponse } from '../../../infrastructure/api/errors.ts';
import { id, instant, record, text, ownLabel } from '../contracts.ts';

// Actual backend database-enums.ts; no runtime import of backend/TypeORM into native.
export const boardActivityLabels = {
  BOARD_UPDATED: 'updated the board',
  BOARD_ARCHIVED: 'archived the board',
  BOARD_RESTORED: 'restored the board',
  MEMBER_ADDED: 'added a board member',
  MEMBER_REMOVED: 'removed a board member',
  ROLE_CHANGED: 'changed a member role',
  COLUMN_CREATED: 'created a column',
  COLUMN_UPDATED: 'updated a column',
  COLUMN_MOVED: 'reordered a column',
  COLUMN_DELETED: 'deleted a column',
  CARD_CREATED: 'created a card',
  CARD_UPDATED: 'updated a card',
  CARD_MOVED: 'moved a card',
  CARD_ARCHIVED: 'archived a card',
  CARD_RESTORED: 'restored a card',
  COMMENT_CREATED: 'added a comment',
  COMMENT_UPDATED: 'edited a comment',
  COMMENT_DELETED: 'deleted a comment',
} as const;
export const boardActivityEntities = [
  'BOARD',
  'MEMBER',
  'COLUMN',
  'CARD',
  'COMMENT',
] as const;

export function decodeBoardActivity(
  value: unknown,
  boardId: string,
  explicitMember: boolean,
) {
  const row = record(value);
  const scope = id(row.boardId);
  const actionType = text(row.actionType, 80);
  const entityType = text(row.entityType, 80);
  if (scope !== boardId || (!explicitMember && entityType === 'MEMBER'))
    throw invalidResponse(200);
  const raw = row.metadata === null ? null : record(row.metadata);
  // Only enum-valued role changes are safe text. Never retain arbitrary JSON,
  // titles, emails, comment bodies, names, or historical resource context.
  const role = (value: unknown) =>
    value === 'OWNER' || value === 'MEMBER' ? value : undefined;
  const metadata =
    raw && actionType === 'ROLE_CHANGED' && entityType === 'MEMBER'
      ? { fromRole: role(raw.fromRole), toRole: role(raw.toRole) }
      : null;
  const actor = row.actor == null ? null : record(row.actor);
  return {
    id: id(row.id),
    boardId: scope,
    actorId: id(row.actorId),
    actor:
      actor?.isDeleted === true && actor.displayName === 'Deleted user'
        ? { isDeleted: true as const, displayName: 'Deleted user' as const }
        : undefined,
    actionType,
    entityType,
    entityId: row.entityId === null ? null : id(row.entityId),
    metadata,
    createdAt: instant(row.createdAt),
  };
}
export type BoardActivity = ReturnType<typeof decodeBoardActivity>;

export function boardAction(row: BoardActivity) {
  const action = ownLabel(boardActivityLabels, row.actionType);
  const roles = row.metadata;
  return roles?.fromRole && roles.toRole
    ? `${action} (${roles.fromRole === 'OWNER' ? 'Owner' : 'Member'} → ${roles.toRole === 'OWNER' ? 'Owner' : 'Member'})`
    : action;
}

/** Never treat a Column/member/comment id or unknown action as a Card link. */
export function activityCardId(row: BoardActivity, boardId: string) {
  return row.boardId === boardId &&
    row.entityType === 'CARD' &&
    Object.hasOwn(boardActivityLabels, row.actionType) &&
    row.actionType.startsWith('CARD_')
    ? row.entityId
    : null;
}
