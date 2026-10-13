import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { retryUnlessClientError } from '../../lib/query-client';
import { useAuth } from '../auth/useAuth';
import {
  archiveBoard,
  createBoard,
  getBoard,
  listBoards,
  updateBoard,
} from './api';
import { boardKeys } from './query-keys';
import type { Board, CreateBoardRequest, UpdateBoardRequest } from './types';

/** Boards the user belongs to, loaded page by page ("Load more"). */
export function useBoards() {
  const { runAuthorized } = useAuth();
  return useInfiniteQuery({
    queryKey: boardKeys.lists(),
    queryFn: ({ pageParam, signal }) =>
      runAuthorized((token) => listBoards(token, pageParam, signal)),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
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

export function useCreateBoard() {
  const { runAuthorized } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBoardRequest) =>
      runAuthorized((token) => createBoard(token, input)),
    onSuccess: (board) => {
      queryClient.setQueryData(boardKeys.detail(board.id), board);
      return queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
}

export function useUpdateBoard(boardId: string) {
  const { runAuthorized } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBoardRequest) =>
      runAuthorized((token) => updateBoard(token, boardId, input)),
    onSuccess: (board) => {
      queryClient.setQueryData(boardKeys.detail(board.id), board);
      return queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
}

export function useArchiveBoard(boardId: string) {
  const { runAuthorized } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => runAuthorized((token) => archiveBoard(token, boardId)),
    onSuccess: (board: Board) => {
      queryClient.setQueryData(boardKeys.detail(board.id), board);
      return queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
}
