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
  renameColumn,
} from './api';
import type { CreateColumnRequest, RenameColumnRequest } from './types';

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
