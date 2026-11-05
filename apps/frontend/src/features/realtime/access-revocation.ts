import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api-client';
import { revokeBoardAccess } from '../boards/revoke-board-access';
import { workspaceKeys } from '../workspaces/query-keys';
import type { WorkspaceSummary } from '../workspaces/types';
import type { Board } from '../boards/types';
import { boardKeys } from '../boards/query-keys';
import { avatarKeys } from '../auth/avatar-query-keys';
import { clearSearch, refreshSearch, searchKey } from '../search/cache';
import {
  clearProductivity,
  productivityKey,
  refreshProductivity,
} from '../productivity/cache';
import {
  changeAllBoardAccessVersions,
  changeBoardAccessVersion,
} from '../boards/access-version';
import { clearNotificationDetails } from '../notifications/cache';

const privateDiscoveryState = {
  queryKey: ['board-discovery'] as const,
  predicate: (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[3] === 'state',
};

/** Drop potentially stale protected data before asking REST to authorize it again. */
export function clearAccessSnapshots(client: QueryClient): void {
  clearProductivity(client);
  clearSearch(client);
  changeAllBoardAccessVersions(client);
  void client.cancelQueries(privateDiscoveryState);
  for (const query of client.getQueryCache().findAll(privateDiscoveryState))
    query.setState({ data: undefined, status: 'pending', error: null });
  for (const key of [boardKeys.all, workspaceKeys.all, avatarKeys.all]) {
    void client.cancelQueries({ queryKey: key });
    for (const query of client.getQueryCache().findAll({ queryKey: key })) {
      query.setState({ data: undefined, status: 'pending', error: null });
    }
  }
}

export function refreshAccessSnapshots(client: QueryClient): void {
  clearAccessSnapshots(client);
  // Re-resolve inbox details so names from lost Boards disappear now.
  clearNotificationDetails(client);
  void client.invalidateQueries({ queryKey: productivityKey });
  void client.invalidateQueries({ queryKey: searchKey });
  void client.invalidateQueries(privateDiscoveryState);
  for (const key of [boardKeys.all, workspaceKeys.all, avatarKeys.all])
    void client.invalidateQueries({ queryKey: key });
}

export function reduceBoardToReadOnly(client: QueryClient, boardId: string) {
  changeBoardAccessVersion(client, boardId);
  void client.resetQueries({ queryKey: avatarKeys.all });
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: ['boards', 'detail'] })) {
    const id = query.queryKey[2];
    if (typeof id !== 'string' || id.toLowerCase() !== boardId.toLowerCase())
      continue;
    if (query.queryKey.length === 3) {
      void client.cancelQueries({ queryKey: query.queryKey });
      client.setQueryData<Board>(
        query.queryKey,
        (board) =>
          board && {
            ...board,
            currentUserRole: null,
            capabilities: {
              canReadBoard: true,
              canWriteBoard: false,
              canManageBoard: false,
              canManageMembers: false,
              canRestoreBoard: false,
            },
          },
      );
    }
    if (query.queryKey[3] === boardKeys.members(id)[3]) {
      void client.cancelQueries({ queryKey: query.queryKey, exact: true });
      query.setState({
        data: undefined,
        status: 'error',
        error: new ApiError(404, 'NOT_FOUND', 'Member details unavailable'),
      });
    }
    if (query.queryKey[3] === 'activities') {
      void client.cancelQueries({ queryKey: query.queryKey, exact: true });
      query.setState({ data: undefined, status: 'pending', error: null });
      void client.invalidateQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

export function receiveBoardRevocation(client: QueryClient, payload: unknown) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('boardId' in payload) ||
    typeof payload.boardId !== 'string'
  )
    return;
  const boardId = payload.boardId.toLowerCase();
  const ids = new Set([
    boardId,
    ...client
      .getQueryCache()
      .findAll({ queryKey: ['boards', 'detail'] })
      .map((query) => query.queryKey[2]),
  ]);
  for (const id of ids) {
    if (typeof id === 'string' && id.toLowerCase() === boardId)
      revokeBoardAccess(client, id);
  }
}

export function receiveWorkspaceRevocation(
  client: QueryClient,
  payload: unknown,
) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('workspaceId' in payload) ||
    typeof payload.workspaceId !== 'string'
  )
    return;
  const workspaceId = payload.workspaceId.toLowerCase();
  refreshProductivity(client);
  refreshSearch(client);
  clearNotificationDetails(client);
  const resources = {
    queryKey: workspaceKeys.all,
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[3] === 'workspace' &&
      typeof query.queryKey[4] === 'string' &&
      query.queryKey[4].toLowerCase() === workspaceId,
  };
  void client.cancelQueries(resources);
  for (const query of client.getQueryCache().findAll(resources))
    query.setState({
      data: null,
      status: 'error',
      error: new ApiError(404, 'NOT_FOUND', 'Workspace unavailable'),
    });
  // Directory membership must be reloaded too. Explicit Board grants are independent.
  const lists = {
    queryKey: workspaceKeys.all,
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[3] === 'list',
  };
  void client.cancelQueries(lists);
  for (const query of client.getQueryCache().findAll(lists)) {
    client.setQueryData<WorkspaceSummary[]>(query.queryKey, (items) =>
      items?.filter((item) => item.id.toLowerCase() !== workspaceId),
    );
  }
}
