import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api-client';
import { boardKeys } from './query-keys';
import { avatarKeys } from '../auth/avatar-query-keys';
import { workspaceKeys } from '../workspaces/query-keys';
import { changeBoardAccessVersion } from './access-version';
import { clearBoardDrafts } from '../cards/card-draft';

export const BOARD_ACCESS_REVOKED = 'BOARD_ACCESS_REVOKED';

/** Keep a denial tombstone so mounted observers cannot revive protected data. */
export function revokeBoardAccess(client: QueryClient, boardId: string) {
  const discoveryState = {
    queryKey: ['board-discovery'],
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[3] === 'state' &&
      typeof query.queryKey[4] === 'string' &&
      query.queryKey[4].toLowerCase() === boardId.toLowerCase(),
  };
  void client.cancelQueries(discoveryState);
  client.removeQueries(discoveryState);
  changeBoardAccessVersion(client, boardId);
  clearBoardDrafts(client, boardId);
  // A shared Board may have been the only permission to read another avatar.
  void client.resetQueries({ queryKey: avatarKeys.all });
  const key = boardKeys.detail(boardId);
  void client.cancelQueries({ queryKey: key });
  client.removeQueries({
    queryKey: key,
    predicate: (query) => query.queryKey.length > key.length,
  });
  client
    .getQueryCache()
    .find({ queryKey: key, exact: true })
    ?.setState({
      data: undefined,
      status: 'error',
      error: new ApiError(404, BOARD_ACCESS_REVOKED, 'Board unavailable'),
    });
  const lists = { queryKey: boardKeys.lists() };
  void client.cancelQueries(lists);
  // Removing a query alone does not notify mounted list observers. Clear
  // their results first so React drops protected names before a new REST read.
  for (const query of client.getQueryCache().findAll(lists)) {
    query.setState({
      data: undefined,
      status: 'error',
      error: new ApiError(404, BOARD_ACCESS_REVOKED, 'Board access changed'),
    });
  }
  client.removeQueries(lists);
  // Workspace pages can retain this Board's name, role and ACL-filtered totals.
  // Hide every cached resource before rechecking REST permissions; directory
  // memberships are independent of Board access and can remain visible.
  const resources = {
    queryKey: workspaceKeys.all,
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[3] === 'workspace',
  };
  const queries = client.getQueryCache().findAll(resources);
  if (!queries.length) return;
  void client.cancelQueries(resources);
  for (const query of queries) {
    query.setState({
      data: null,
      status: 'error',
      error: new ApiError(
        409,
        'BOARD_ACCESS_CHANGED',
        'Board access changed. Reload workspace.',
      ),
    });
  }
  void client.invalidateQueries(resources);
}
