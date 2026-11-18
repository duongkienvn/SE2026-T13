import { queryOptions } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import type { PrivateQueryKey } from '../../infrastructure/query/keys.ts';
import type { ResourceId } from '../../navigation/routes.ts';
import { decodeBoard } from '../boards/api.ts';
import { createWorkspaceApi } from '../workspaces/api.ts';
import { evictWorkspace, isWorkspaceDenied } from '../workspaces/queries.ts';
import { canRetryWorkspace } from '../workspaces/status.ts';
import { activityPageSize } from './contracts.ts';
import { activityKeys, activityPageKey } from './keys.ts';
import { createBoardActivityApi } from './board/api.ts';
import { createWorkspaceActivityApi } from './workspace/api.ts';

export function discardActivity(
  data: MobileDataLayer,
  identity: SessionIdentity,
  prefix: PrivateQueryKey,
) {
  data.cancelResourceRequests(prefix);
  data.evict(identity, [prefix]);
}

function cooldown(data: MobileDataLayer, prefix: PrivateQueryKey) {
  for (const query of data.queryClient
    .getQueryCache()
    .findAll({ queryKey: prefix })) {
    if (!canRetryWorkspace(query.state.error, query.state.errorUpdatedAt))
      throw query.state.error;
  }
}

/** A permission transition discards old pages before the new history request. */
function checkScope(
  data: MobileDataLayer,
  identity: SessionIdentity,
  prefix: PrivateQueryKey,
  scope: string,
) {
  for (const query of data.queryClient
    .getQueryCache()
    .findAll({ queryKey: prefix })) {
    const previous = query.state.data as
      { permissionScope?: string } | undefined;
    if (previous && previous.permissionScope !== scope) {
      discardActivity(data, identity, prefix);
      throw new ApiError('session-changed', {
        code: 'RESOURCE_ACCESS_CHANGED',
      });
    }
  }
}

const defaults = {
  gcTime: 0,
  staleTime: 1_000,
  retry: false,
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;

export function workspaceActivityOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  workspaceId: ResourceId,
  page: number,
) {
  const prefix = activityKeys.workspace(identity, workspaceId);
  return queryOptions({
    ...defaults,
    queryKey: activityPageKey(prefix, page, activityPageSize),
    async queryFn({ signal }) {
      cooldown(data, prefix);
      const current = data.resources.capture(prefix, false);
      try {
        // Workspace detail itself requires explicit membership; a Board grant cannot substitute.
        const workspace = await createWorkspaceApi(data.api, identity).detail(
          workspaceId,
          signal,
        );
        data.assertCurrent(identity);
        current();
        const permissionScope = workspace.role;
        checkScope(data, identity, prefix, permissionScope);
        const result = await createWorkspaceActivityApi(
          data.api,
          identity,
          workspaceId,
        ).list(page, workspace.role, signal);
        current();
        return {
          ...result,
          name: workspace.name,
          permissionScope,
          archived: false,
        };
      } catch (error) {
        if (!signal.aborted && isWorkspaceDenied(error))
          evictWorkspace(data, identity, workspaceId);
        else if (
          !signal.aborted &&
          error instanceof ApiError &&
          error.kind === 'invalid-response'
        )
          discardActivity(data, identity, prefix);
        throw error;
      }
    },
  });
}

export function boardActivityOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: ResourceId,
  page: number,
  onAccessDenied?: () => void,
) {
  const prefix = activityKeys.board(identity, boardId);
  return queryOptions({
    ...defaults,
    queryKey: activityPageKey(prefix, page, activityPageSize),
    async queryFn({ signal }) {
      cooldown(data, prefix);
      const probeCurrent = data.resources.captureBoardProbe(boardId);
      let accessConfirmed = false;
      try {
        // Untagged probe can re-establish a fenced grant without recursive denial checks.
        const board = await data.api.json(`/boards/${boardId}`, decodeBoard, {
          identity,
          signal,
          expectedStatus: 200,
          retries: 0,
        });
        data.assertCurrent(identity);
        probeCurrent();
        if (signal.aborted) throw new ApiError('aborted');
        if (board.id !== boardId || !board.capabilities.canReadBoard)
          throw new ApiError('http', { status: 404 });
        data.resources.confirmBoard(
          boardId,
          !board.isArchived && board.capabilities.canWriteBoard,
          board.workspaceId,
        );
        accessConfirmed = true;
        const permissionScope = `${board.workspaceId}:${board.currentUserRole ?? 'reader'}`;
        checkScope(data, identity, prefix, permissionScope);
        const current = data.resources.capture(prefix, false);
        const result = await createBoardActivityApi(
          data.api,
          identity,
          boardId,
        ).list(page, board.currentUserRole !== null, signal);
        current();
        return {
          ...result,
          name: board.name,
          permissionScope,
          archived: board.isArchived,
        };
      } catch (error) {
        if (!signal.aborted && isWorkspaceDenied(error)) {
          data.assertCurrent(identity);
          probeCurrent();
          // A denied Board detail probe is authoritative; child failures still
          // use MOB-06's independent resource recheck.
          if (!accessConfirmed) onAccessDenied?.();
          discardActivity(data, identity, prefix);
        } else if (
          !signal.aborted &&
          error instanceof ApiError &&
          error.kind === 'invalid-response'
        )
          discardActivity(data, identity, prefix);
        throw error;
      }
    },
  });
}
