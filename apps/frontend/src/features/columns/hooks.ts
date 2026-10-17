import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../lib/api-client';
import { retryUnlessClientError } from '../../lib/query-client';
import { useAuth } from '../auth/useAuth';
import { useRefreshIfArchived } from '../boards/hooks';
import { boardKeys } from '../boards/query-keys';
import {
  createColumn,
  deleteColumn,
  listAllColumns,
  moveColumn,
  renameColumn,
} from './api';
import type {
  CreateColumnRequest,
  MoveColumnRequest,
  RenameColumnRequest,
} from './types';

export const COLUMN_NOT_EMPTY = 'COLUMN_NOT_EMPTY';

export function useColumns(boardId: string, { enabled = true } = {}) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: boardKeys.columns(boardId),
    queryFn: ({ signal }) =>
      runAuthorized((token) => listAllColumns(token, boardId, signal)),
    retry: retryUnlessClientError,
    enabled,
  });
}

function useInvalidateColumns(boardId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: boardKeys.columns(boardId) });
}

/** Also refetches the columns when the column was deleted meanwhile (404). */
function useRefreshAfterColumnError(boardId: string) {
  const invalidate = useInvalidateColumns(boardId);
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return (error: unknown) => {
    refreshIfArchived(error);
    if (isApiError(error) && error.status === 404) void invalidate();
  };
}

export function useCreateColumn(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateColumns(boardId);
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return useMutation({
    mutationFn: (input: CreateColumnRequest) =>
      runAuthorized((token) => createColumn(token, boardId, input)),
    onSuccess: invalidate,
    onError: refreshIfArchived,
  });
}

export function useRenameColumn(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateColumns(boardId);
  const onError = useRefreshAfterColumnError(boardId);
  return useMutation({
    mutationFn: ({
      columnId,
      ...input
    }: RenameColumnRequest & { columnId: string }) =>
      runAuthorized((token) => renameColumn(token, boardId, columnId, input)),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * Resolves once the reordered columns are refetched, so a drag preview can be
 * dropped without flicker. Any failure refetches the server's order.
 */
export function useMoveColumn(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateColumns(boardId);
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return useMutation({
    mutationFn: ({
      columnId,
      ...input
    }: MoveColumnRequest & { columnId: string }) =>
      runAuthorized((token) => moveColumn(token, boardId, columnId, input)),
    onSuccess: invalidate,
    onError: (error) => {
      refreshIfArchived(error);
      void invalidate();
    },
  });
}

export function useDeleteColumn(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateColumns(boardId);
  const onError = useRefreshAfterColumnError(boardId);
  return useMutation({
    mutationFn: (columnId: string) =>
      runAuthorized((token) => deleteColumn(token, boardId, columnId)),
    onSuccess: invalidate,
    onError,
  });
}
