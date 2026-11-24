import type { AccountDeletionBlockerType } from '@kanban/shared';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import {
  destinationPath,
  parseResourceId,
  type DestinationPath,
} from '../../navigation/routes.ts';
import { decodeBoard } from '../boards/api.ts';
import { decodeWorkspace } from '../workspaces/decoder.ts';
import { evictWorkspace } from '../workspaces/queries.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';

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
    action: 'Review board ownership',
    help: 'Assign another explicit Board OWNER. For archived boards, restore the board from Board Settings first. Workspace ADMIN status does not grant Board ownership.',
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
  const workspaceTarget = type === 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN';
  // As in Inbox navigation, an explicit REST probe may recover a revoked grant.
  // Its captured revision still rejects access loss during the request.
  const probe = workspaceTarget
    ? data.resources.captureWorkspaceProbe(id)
    : data.resources.captureBoardProbe(id);
  const check = () => {
    data.assertCurrent(identity);
    probe();
    if (signal.aborted)
      throw new ApiError('aborted', { requestStarted: false });
  };
  const options = {
    identity,
    signal,
    expectedStatus: 200,
    retries: 0 as const,
  };
  let path: DestinationPath | null = null;
  try {
    if (type === 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN') {
      const workspace = await data.api.json(
        `/workspaces/${id}`,
        decodeWorkspace,
        options,
      );
      check();
      if (workspace.id !== id)
        throw new ApiError('invalid-response', { status: 200 });
      data.resources.confirmWorkspace(id);
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
      const board = await data.api.json(`/boards/${id}`, decodeBoard, options);
      check();
      if (board.id !== id || !board.capabilities.canReadBoard)
        throw new ApiError('invalid-response', { status: 200 });
      data.resources.confirmBoard(
        id,
        board.capabilities.canWriteBoard,
        board.workspaceId,
      );
      const restore = board.isArchived && board.capabilities.canRestoreBoard;
      if (
        board.currentUserRole === 'OWNER' &&
        (restore ||
          (type === 'PERSONAL_WORKSPACE_HAS_BOARDS'
            ? board.capabilities.canManageBoard
            : board.capabilities.canManageMembers))
      )
        path = destinationPath({
          kind:
            restore || type === 'PERSONAL_WORKSPACE_HAS_BOARDS'
              ? 'boardSettings'
              : 'boardMembers',
          boardId: id,
        });
    }
    return path;
  } catch (error) {
    check();
    if (error instanceof ApiError && [403, 404].includes(error.status)) {
      if (workspaceTarget) evictWorkspace(data, identity, id);
      else {
        data.resources.fenceBoard(id, true);
        data.evict(identity, [queryKeys.board(identity, id)]);
      }
    }
    throw error;
  }
}
