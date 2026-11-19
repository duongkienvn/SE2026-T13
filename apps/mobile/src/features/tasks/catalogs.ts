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
import { createKanbanApi } from '../boards/kanban-api';
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
    enabled: ({ state }) =>
      enabled && canRetryWorkspace(state.error, state.errorUpdatedAt),
    refetchOnWindowFocus: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    refetchOnReconnect: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const parent = workspaceId ? parseResourceId(workspaceId) : null;
  const boards = useInfiniteQuery({
    queryKey: queryKeys.boards(identity, workspaceId ?? null, {
      source: 'task-filter-options',
    }),
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
    enabled: ({ state }) =>
      enabled && canRetryWorkspace(state.error, state.errorUpdatedAt),
    refetchOnWindowFocus: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    refetchOnReconnect: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    retry: false,
    staleTime: 0,
    gcTime: 0,
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
    enabled: ({ state }) =>
      enabled &&
      !!boardId &&
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    refetchOnWindowFocus: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    refetchOnReconnect: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    staleTime: 0,
    retry: false,
  });
  const labels = useInfiniteQuery({
    queryKey: queryKeys.labels(identity, boardId ?? ''),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      createKanbanApi(data.api, identity, boardId ?? '').labels(
        pageParam,
        signal,
      ),
    getNextPageParam: (page) => (page ? nextPage(page.meta) : undefined),
    enabled: ({ state }) =>
      enabled &&
      access.isSuccess &&
      !access.isFetching &&
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    refetchOnWindowFocus: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    refetchOnReconnect: ({ state }) =>
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  return {
    workspaces,
    boards,
    access,
    labels,
    labelItems:
      !access.isSuccess ||
      access.isFetching ||
      !labels.isFetchedAfterMount ||
      labels.isFetching ||
      labels.isError ||
      labels.data?.pages.some((page) => page === null)
        ? []
        : deduplicatePages(
            labels.data?.pages.map((page) => page?.data ?? []) ?? [],
          ),
    boardItems:
      boards.isFetching || boards.isError || !boards.isFetchedAfterMount
        ? []
        : deduplicatePages(boards.data?.pages.map(({ data }) => data) ?? []),
  };
}
