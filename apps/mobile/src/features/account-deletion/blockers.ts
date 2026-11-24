import type { AccountDeletionBlockerType } from '@kanban/shared';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import {
  destinationPath,
  parseResourceId,
  type DestinationPath,
} from '../../navigation/routes.ts';
import { createBoardApi } from '../boards/api.ts';
import { createWorkspaceApi } from '../workspaces/api.ts';

export const blockerCopy: Record<
  AccountDeletionBlockerType,
  { title: string; action: string; help: string }
> = {
  PERSONAL_WORKSPACE_HAS_BOARDS: {
    title: 'Boards in your Personal workspace',
    action: 'Open board settings',
    help: 'Move every board, including archived boards, to an eligible Team workspace. Open Board Settings to review the available move or restore actions.',
  },
  BOARD_REQUIRES_ANOTHER_OWNER: {
    title: 'Boards needing another owner',
    action: 'Open board members',
    help: 'Assign another explicit Board OWNER, including for archived boards. Workspace ADMIN status does not grant Board ownership.',
  },
  TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN: {
    title: 'Team workspaces needing another admin',
    action: 'Open workspace members',
    help: 'Assign another Team workspace ADMIN before deleting your account.',
  },
};

/** Blocker summaries identify resources, never grant access. Fetch fresh ACL on every tap. */
export async function blockerDestination(
  data: MobileDataLayer,
  identity: SessionIdentity,
  type: AccountDeletionBlockerType,
  resource: string,
  signal: AbortSignal,
): Promise<DestinationPath | null> {
  data.assertCurrent(identity);
  const id = parseResourceId(resource);
  if (!id) return null;
  let path: DestinationPath | null = null;
  if (type === 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN') {
    const workspace = await createWorkspaceApi(data.api, identity).detail(
      id,
      signal,
    );
    if (
      workspace.type === 'TEAM' &&
      workspace.role === 'ADMIN' &&
      workspace.canManage
    )
      path = destinationPath({
        kind: 'workspaceSection',
        workspaceId: id,
        section: 'members',
      });
  } else {
    const board = await createBoardApi(data.api, identity).detail(id, signal);
    if (
      board.currentUserRole === 'OWNER' &&
      (type === 'PERSONAL_WORKSPACE_HAS_BOARDS'
        ? board.capabilities.canManageBoard
        : board.capabilities.canManageMembers)
    )
      path = destinationPath({
        kind:
          type === 'PERSONAL_WORKSPACE_HAS_BOARDS'
            ? 'boardSettings'
            : 'boardMembers',
        boardId: id,
      });
  }
  data.assertCurrent(identity);
  if (signal.aborted) throw new ApiError('aborted', { requestStarted: false });
  return path;
}
