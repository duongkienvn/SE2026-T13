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

function useCommentMutation(boardId: string, cardId: string) {
  const queryClient = useQueryClient();
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return {
    invalidate: () =>
      queryClient.invalidateQueries({
        queryKey: commentKeys.card(boardId, cardId),
      }),
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
  const { invalidate, onError } = useCommentMutation(boardId, cardId);
  return useMutation({
    mutationFn: (input: CommentRequest) =>
      runAuthorized((token) => createComment(token, boardId, cardId, input)),
    onSuccess: invalidate,
    onError,
  });
}

export function useUpdateComment(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const { invalidate, onError } = useCommentMutation(boardId, cardId);
  return useMutation({
    mutationFn: ({
      commentId,
      ...input
    }: CommentRequest & { commentId: string }) =>
      runAuthorized((token) =>
        updateComment(token, boardId, cardId, commentId, input),
      ),
    onSuccess: invalidate,
    onError,
  });
}

export function useDeleteComment(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const { invalidate, onError } = useCommentMutation(boardId, cardId);
  return useMutation({
    mutationFn: (commentId: string) =>
      runAuthorized((token) =>
        deleteComment(token, boardId, cardId, commentId),
      ),
    onSuccess: invalidate,
    onError,
  });
}
