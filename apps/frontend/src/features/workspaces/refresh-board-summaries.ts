import type { QueryClient } from '@tanstack/react-query';
import { boardKeys } from '../boards/query-keys';
import type { Board } from '../boards/types';
import { workspaceKeys } from './query-keys';
import type { WorkspaceOverview } from './types';
import type { WorkspaceBoardsPageData } from './boards/types';

/** Drop count/roster authority before rechecking just the affected Workspaces. */
export function refreshWorkspaceBoardSummaries(
  client: QueryClient,
  boardId: string,
) {
  const workspaceIds = new Set<string>();
  const source = client.getQueryData<Board>(
    boardKeys.detail(boardId),
  )?.workspaceId;
  if (source) workspaceIds.add(source);
  const queries = client
    .getQueryCache()
    .findAll({ queryKey: workspaceKeys.all });
  for (const query of queries) {
    const data = query.state.data as
      WorkspaceOverview | WorkspaceBoardsPageData | null | undefined;
    if (
      !data ||
      query.queryKey[3] !== 'workspace' ||
      !['boards', 'overview'].includes(String(query.queryKey[5]))
    )
      continue;
    const boards =
      'recentBoards' in data
        ? data.recentBoards
        : 'items' in data
          ? data.items
          : [];
    if (boards.some((board) => board.id === boardId))
      workspaceIds.add(String(query.queryKey[4]));
  }
  const affected = {
    queryKey: workspaceKeys.all,
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[3] === 'workspace' &&
      workspaceIds.has(String(query.queryKey[4])) &&
      ['boards', 'overview'].includes(String(query.queryKey[5])),
  };
  void client.cancelQueries(affected);
  for (const query of client.getQueryCache().findAll(affected))
    query.setState({ data: undefined, error: null, status: 'pending' });
  void client.invalidateQueries(affected);
}
