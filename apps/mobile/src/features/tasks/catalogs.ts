import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import {
  deduplicatePages,
  nextPage,
} from '../../infrastructure/query/pagination';
import { createBoardApi } from '../boards/api';
import { createWorkspaceApi } from '../workspaces/api';
import { workspaceDirectoryOptions } from '../workspaces/queries';
import { useKanbanCatalogs } from '../boards/kanban-queries';
import { decodeBoardAccess } from '../../infrastructure/realtime/rooms';
import { ApiError } from '../../infrastructure/api/errors';
import { parseResourceId } from '../../navigation/routes';
import { canRetryWorkspace } from '../workspaces/status';

export function useTaskCatalogs(
  identity: SessionIdentity,
  workspaceId: string | undefined,
  boardId: string | undefined,
  enabled: boolean,
) {
  const data = useMobileData();
  const workspaces = useQuery({
    ...workspaceDirectoryOptions(data, identity),
    enabled,
    retry: false,
    staleTime: 0,
  });
  const parent = workspaceId ? parseResourceId(workspaceId) : null;
  const boards = useInfiniteQuery({
    queryKey: [
      ...queryKeys.boardLists(identity),
      'task-filter-options',
      workspaceId,
    ] as const,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      parent
        ? createWorkspaceApi(data.api, identity).boards(
            parent,
            pageParam,
            { status: 'active', sort: 'name' },
            signal,
          )
        : createBoardApi(data.api, identity).list(pageParam, 'active', signal),
    getNextPageParam: (page) => nextPage(page.meta),
    enabled,
    retry: false,
    staleTime: 0,
  });
  const access = useQuery({
    queryKey: [
      ...queryKeys.board(identity, boardId ?? ''),
      'task-filter-access',
    ] as const,
    queryFn: async ({ signal }) => {
      const board = await data.api.json(
        '/boards/' + boardId,
        decodeBoardAccess,
        {
          identity,
          signal,
          expectedStatus: 200,
          retries: 0,
        },
      );
      if (
        board.id !== boardId ||
        !board.capabilities.canReadBoard ||
        board.isArchived ||
        (workspaceId && board.workspaceId !== workspaceId)
      )
        throw new ApiError('http', { status: 403 });
      data.resources.confirmBoard(
        board.id,
        board.capabilities.canWriteBoard,
        board.workspaceId,
      );
      return board;
    },
    enabled: enabled && !!boardId,
    staleTime: 0,
    retry: false,
  });
  const labels = useKanbanCatalogs(
    data.api,
    identity,
    boardId ?? '',
    enabled && access.isSuccess && !access.isFetching,
    false,
  );
  return {
    workspaces,
    boards,
    access,
    labels: labels.labels,
    labelItems: labels.labelItems,
    boardItems: deduplicatePages(
      boards.data?.pages.map(({ data }) => data) ?? [],
    ),
  };
}

export function catalogRetryAllowed(error: unknown, at: number) {
  return canRetryWorkspace(error, at);
}
