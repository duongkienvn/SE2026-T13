import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../lib/api-client';
import { retryUnlessClientError } from '../../lib/query-client';
import { useAuth } from '../auth/useAuth';
import { useRefreshIfArchived } from '../boards/hooks';
import { boardKeys } from '../boards/query-keys';
import {
  archiveCard,
  assignCard,
  createCard,
  getCard,
  listAllCards,
  unassignCard,
  updateCard,
} from './api';
import type { Card, CreateCardRequest, UpdateCardRequest } from './types';

export const CARD_ARCHIVED = 'CARD_ARCHIVED';

/** Every active card of the board; group them with `groupCardsByColumn`. */
export function useCards(boardId: string, { enabled = true } = {}) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: boardKeys.cards(boardId),
    queryFn: ({ signal }) =>
      runAuthorized((token) => listAllCards(token, boardId, signal)),
    retry: retryUnlessClientError,
    enabled,
  });
}

/** One card, archived or not. */
export function useCard(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: boardKeys.card(boardId, cardId),
    queryFn: ({ signal }) =>
      runAuthorized((token) => getCard(token, boardId, cardId, signal)),
    retry: retryUnlessClientError,
  });
}

/**
 * Stores the card the server returned, then refetches the active card list
 * (an archived card drops out of it).
 */
function useSaveCard(boardId: string) {
  const queryClient = useQueryClient();
  return (card: Card) => {
    queryClient.setQueryData(boardKeys.card(boardId, card.id), card);
    return queryClient.invalidateQueries({
      queryKey: boardKeys.cards(boardId),
      exact: true,
    });
  };
}

/**
 * Like `useRefreshIfArchived`, and also refetches the cards when the card was
 * archived or removed since it was loaded, so the page shows the real state.
 */
function useRefreshAfterCardError(boardId: string) {
  const queryClient = useQueryClient();
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return (error: unknown) => {
    refreshIfArchived(error);
    if (
      isApiError(error) &&
      (error.code === CARD_ARCHIVED || error.status === 404)
    ) {
      void queryClient.invalidateQueries({
        queryKey: boardKeys.cards(boardId),
      });
    }
  };
}

export function useCreateCard(boardId: string) {
  const { runAuthorized } = useAuth();
  const save = useSaveCard(boardId);
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return useMutation({
    mutationFn: (input: CreateCardRequest) =>
      runAuthorized((token) => createCard(token, boardId, input)),
    onSuccess: save,
    onError: refreshIfArchived,
  });
}

export function useUpdateCard(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const save = useSaveCard(boardId);
  const onError = useRefreshAfterCardError(boardId);
  return useMutation({
    mutationFn: (input: UpdateCardRequest) =>
      runAuthorized((token) => updateCard(token, boardId, cardId, input)),
    onSuccess: save,
    onError,
  });
}

export function useArchiveCard(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const save = useSaveCard(boardId);
  const onError = useRefreshAfterCardError(boardId);
  return useMutation({
    mutationFn: () =>
      runAuthorized((token) => archiveCard(token, boardId, cardId)),
    onSuccess: save,
    onError,
  });
}

/** Assign and unassign answer without the card, so both refetch it. */
function useInvalidateCard(boardId: string, cardId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: boardKeys.card(boardId, cardId),
      }),
      queryClient.invalidateQueries({
        queryKey: boardKeys.cards(boardId),
        exact: true,
      }),
    ]);
}

export function useAssignCard(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateCard(boardId, cardId);
  const onError = useRefreshAfterCardError(boardId);
  return useMutation({
    mutationFn: (userId: string) =>
      runAuthorized((token) => assignCard(token, boardId, cardId, { userId })),
    onSuccess: invalidate,
    onError,
  });
}

export function useUnassignCard(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateCard(boardId, cardId);
  const onError = useRefreshAfterCardError(boardId);
  return useMutation({
    mutationFn: (userId: string) =>
      runAuthorized((token) => unassignCard(token, boardId, cardId, userId)),
    onSuccess: invalidate,
    onError,
  });
}
