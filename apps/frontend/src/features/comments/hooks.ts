import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../lib/api-client';
import { retryUnlessClientError } from '../../lib/query-client';
import { useAuth } from '../auth/useAuth';
import { useRefreshIfArchived } from '../boards/hooks';
import { boardKeys } from '../boards/query-keys';
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from './api';
import type { CommentRequest } from './types';
import { commentKeys } from './query-keys';
import { previewSummaryFilters } from '../cards/preview-summary-cache';
import { beginCommentOperation } from '../realtime/local-operation';

export { commentKeys } from './query-keys';

export function useComments(boardId: string, cardId: string, page: number) {
  const { runAuthorized, user } = useAuth();
  return useQuery({
    queryKey: commentKeys.page(boardId, cardId, page),
    queryFn: ({ signal }) =>
      runAuthorized((token) =>
        listComments(token, boardId, cardId, page, signal),
      ),
    enabled: !!user,
    retry: retryUnlessClientError,
  });
}

function useCommentMutation(
  boardId: string,
  cardId: string,
  refreshCount = true,
) {
  const queryClient = useQueryClient();
  const refreshIfArchived = useRefreshIfArchived(boardId);
  const invalidate = () =>
    Promise.all([
      ...(refreshCount
        ? [
            queryClient.invalidateQueries(
              previewSummaryFilters(boardId, cardId),
              { throwOnError: true },
            ),
          ]
        : []),
      queryClient.invalidateQueries(
        { queryKey: commentKeys.card(boardId, cardId) },
        { throwOnError: true },
      ),
    ]);
  return {
    run: async <T>(
      event: 'comment:created' | 'comment:updated' | 'comment:deleted',
      request: (operationId?: string) => Promise<T>,
    ): Promise<T> => {
      const operation = beginCommentOperation(
        queryClient,
        event,
        boardId,
        cardId,
      );
      let result: T;
      try {
        result = await request(operation?.id);
      } catch (error) {
        operation?.failure();
        throw error;
      }
      try {
        await invalidate();
        operation?.success();
      } catch {
        // A committed write remains successful; replay a buffered hint for retry.
        operation?.failure();
      }
      return result;
    },
    onError: (error: unknown) => {
      refreshIfArchived(error);
      if (isApiError(error) && error.code === 'CARD_ARCHIVED') {
        void queryClient.invalidateQueries({
          queryKey: boardKeys.card(boardId, cardId),
        });
      }
    },
  };
}

export function useCreateComment(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const { run, onError } = useCommentMutation(boardId, cardId);
  return useMutation({
    mutationFn: (input: CommentRequest) =>
      run('comment:created', (id) =>
        runAuthorized((token) =>
          createComment(token, boardId, cardId, input, id),
        ),
      ),
    onError,
  });
}

export function useUpdateComment(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const { run, onError } = useCommentMutation(boardId, cardId, false);
  return useMutation({
    mutationFn: ({
      commentId,
      ...input
    }: CommentRequest & { commentId: string }) =>
      run('comment:updated', (id) =>
        runAuthorized((token) =>
          updateComment(token, boardId, cardId, commentId, input, id),
        ),
      ),
    onError,
  });
}

export function useDeleteComment(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const { run, onError } = useCommentMutation(boardId, cardId);
  return useMutation({
    mutationFn: (commentId: string) =>
      run('comment:deleted', (id) =>
        runAuthorized((token) =>
          deleteComment(token, boardId, cardId, commentId, id),
        ),
      ),
    onError,
  });
}
