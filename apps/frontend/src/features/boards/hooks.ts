import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BOARD_ARCHIVED, isApiError } from '../../lib/api-client';
import { retryUnlessClientError } from '../../lib/query-client';
import { useAuth } from '../auth/useAuth';
import { useAuthSession } from '../auth/auth-session-context';
import { workspaceKeys } from '../workspaces/query-keys';
import {
  archiveBoard,
  createBoard,
  getBoard,
  listAllBoards,
  restoreBoard,
  updateBoard,
} from './api';
import { boardKeys } from './query-keys';
import type { Board, CreateBoardRequest, UpdateBoardRequest } from './types';
import { boardAccessVersion } from './access-version';

/** Every board the user belongs to; the page searches and paginates them. */
export function useBoards(status: 'active' | 'archived' = 'active') {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: boardKeys.list(status),
    queryFn: ({ signal }) =>
      runAuthorized((token) => listAllBoards(token, signal, status)),
    retry: retryUnlessClientError,
  });
}

export function useBoard(boardId: string, { enabled = true } = {}) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: boardKeys.detail(boardId),
    queryFn: ({ signal }) =>
      runAuthorized((token) => getBoard(token, boardId, signal)),
    retry: retryUnlessClientError,
    enabled,
  });
}

/**
 * A change refused with BOARD_ARCHIVED means someone archived the board since
 * it was loaded: refresh it so the page switches to its read-only state.
 */
export function useRefreshIfArchived(boardId: string) {
  const queryClient = useQueryClient();
  return (error: unknown) => {
    if (!isApiError(error) || error.code !== BOARD_ARCHIVED) return;
    void queryClient.invalidateQueries({ queryKey: boardKeys.detail(boardId) });
    void queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
  };
}

export function useCreateBoard() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBoardRequest) =>
      runAuthorized((token) => createBoard(token, input)),
    onSuccess: (board) => {
      if (!scope.isCurrent()) return;
      queryClient.setQueryData(boardKeys.detail(board.id), board);
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.session(user?.id ?? '', scope.generation),
      });
      return queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
}

export function useUpdateBoard(boardId: string) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const queryClient = useQueryClient();
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return useMutation({
    mutationFn: (input: UpdateBoardRequest) =>
      runAuthorized((token) => updateBoard(token, boardId, input)),
    onMutate: () => boardAccessVersion(queryClient, boardId),
    onSuccess: (board, _input, version) => {
      if (
        !scope.isCurrent() ||
        version !== boardAccessVersion(queryClient, boardId)
      )
        return;
      queryClient.setQueryData(boardKeys.detail(board.id), board);
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.session(user?.id ?? '', scope.generation),
      });
      return queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
    onError: refreshIfArchived,
  });
}

export function useArchiveBoard(boardId: string) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const queryClient = useQueryClient();
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return useMutation({
    mutationFn: () => runAuthorized((token) => archiveBoard(token, boardId)),
    onMutate: () => boardAccessVersion(queryClient, boardId),
    onSuccess: (board: Board, _input, version) => {
      if (
        !scope.isCurrent() ||
        version !== boardAccessVersion(queryClient, boardId)
      )
        return;
      queryClient.setQueryData(boardKeys.detail(board.id), board);
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.session(user?.id ?? '', scope.generation),
      });
      return queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
    onError: refreshIfArchived,
  });
}

export function useRestoreBoard(boardId: string) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => runAuthorized((token) => restoreBoard(token, boardId)),
    onMutate: () => boardAccessVersion(queryClient, boardId),
    onSuccess: (board: Board, _input, version) => {
      if (
        !scope.isCurrent() ||
        version !== boardAccessVersion(queryClient, boardId)
      )
        return;
      queryClient.setQueryData(boardKeys.detail(board.id), board);
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.session(user?.id ?? '', scope.generation),
      });
      return queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
}
