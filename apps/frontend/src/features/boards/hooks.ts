import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { retryUnlessClientError } from '../../lib/query-client';
import { useAuth } from '../auth/useAuth';
import {
  archiveBoard,
  createBoard,
  getBoard,
  listAllBoards,
  updateBoard,
} from './api';
import { boardKeys } from './query-keys';
import type { Board, CreateBoardRequest, UpdateBoardRequest } from './types';

/** Every board the user belongs to; the page searches and paginates them. */
export function useBoards() {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: boardKeys.lists(),
    queryFn: ({ signal }) =>
      runAuthorized((token) => listAllBoards(token, signal)),
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
