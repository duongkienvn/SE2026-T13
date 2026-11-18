import { WorkspaceRole } from '@kanban/shared';
import { invalidResponse } from '../../../infrastructure/api/errors.ts';
import { id, instant, record, text, ownLabel } from '../contracts.ts';

// WorkspaceActivityType is backend-only. Keep this vetted contract local to native.
export const workspaceActivityLabels = {
  WORKSPACE_CREATED: 'created the workspace',
  WORKSPACE_UPDATED: 'updated the workspace',
  POLICY_UPDATED: 'updated workspace policies',
  MEMBER_JOINED: 'joined the workspace',
  MEMBER_ROLE_CHANGED: 'changed a member role',
  MEMBER_REMOVED: 'removed a member',
  MEMBER_LEFT: 'left the workspace',
  INVITATION_REQUESTED: 'requested an invitation',
  INVITATION_REVOKED: 'revoked an invitation',
  INVITATION_DECLINED: 'declined an invitation',
  BOARD_MOVED: 'moved a board into the workspace',
} as const;

const memberEvents = new Set([
  'WORKSPACE_CREATED',
  'WORKSPACE_UPDATED',
  'POLICY_UPDATED',
  'MEMBER_JOINED',
  'MEMBER_ROLE_CHANGED',
  'MEMBER_REMOVED',
  'MEMBER_LEFT',
  'BOARD_MOVED',
]);

export function decodeWorkspaceActivity(value: unknown, role: WorkspaceRole) {
  const row = record(value);
  const eventType = text(row.eventType, 80);
  // Fail closed rather than filter one page and misrepresent the server total.
  if (role !== WorkspaceRole.ADMIN && !memberEvents.has(eventType))
    throw invalidResponse(200);
  const actor = row.actor === null ? null : record(row.actor);
  if (
    actor &&
    ((actor.isDeleted !== undefined && typeof actor.isDeleted !== 'boolean') ||
      !(actor.avatarUrl === null || typeof actor.avatarUrl === 'string'))
  )
    throw invalidResponse(200);
  const board = row.board === null ? null : record(row.board);
  if (board && eventType !== 'BOARD_MOVED') throw invalidResponse(200);
  return {
    id: id(row.id),
    eventType,
    createdAt: instant(row.createdAt),
    actor: actor
      ? {
          id: id(actor.id),
          displayName:
            actor.isDeleted === true ? 'Deleted user' : text(actor.displayName),
          isDeleted: actor.isDeleted === true,
          // Native uses initials: do not retain or request a historical private avatar.
          avatarUrl: null,
        }
      : null,
    board: board ? { id: id(board.id), name: text(board.name) } : null,
  };
}

export type WorkspaceActivity = ReturnType<typeof decodeWorkspaceActivity>;
export const workspaceAction = (row: WorkspaceActivity) =>
  ownLabel(workspaceActivityLabels, row.eventType);
