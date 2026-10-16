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
  moveCard,
  unassignCard,
  updateCard,
} from './api';
import type {
  Card,
  CreateCardRequest,
  MoveCardRequest,
  UpdateCardRequest,
} from './types';

export const CARD_ARCHIVED = 'CARD_ARCHIVED';
export const CARD_ASSIGNEE_EXISTS = 'CARD_ASSIGNEE_EXISTS';
export const BOARD_MEMBER_NOT_FOUND = 'BOARD_MEMBER_NOT_FOUND';

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

/**
 * One card, archived or not. `placeholder` (the board's copy) is shown while
 * the latest version loads.
 */
export function useCard(boardId: string, cardId: string, placeholder?: Card) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: boardKeys.card(boardId, cardId),
    queryFn: ({ signal }) =>
      runAuthorized((token) => getCard(token, boardId, cardId, signal)),
    retry: retryUnlessClientError,
    placeholderData: placeholder,
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
    if (!isApiError(error)) return;
    if (error.code === BOARD_MEMBER_NOT_FOUND) {
      // The picked person left the board: refresh who can be assigned.
      void queryClient.invalidateQueries({
        queryKey: boardKeys.members(boardId),
      });
    } else if (
      error.code === CARD_ARCHIVED ||
      error.code === CARD_ASSIGNEE_EXISTS ||
      error.status === 404
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

/**
 * Resolves once the active card list is refetched, so a drag preview can be
 * dropped without flicker. Any failure refetches the server's order (and the
 * columns, in case the destination was deleted meanwhile).
 */
export function useMoveCard(boardId: string) {
  const { runAuthorized } = useAuth();
  const queryClient = useQueryClient();
  const save = useSaveCard(boardId);
  const refreshIfArchived = useRefreshIfArchived(boardId);
  return useMutation({
    mutationFn: ({ cardId, ...input }: MoveCardRequest & { cardId: string }) =>
      runAuthorized((token) => moveCard(token, boardId, cardId, input)),
    onSuccess: save,
    onError: (error) => {
      refreshIfArchived(error);
      void queryClient.invalidateQueries({
        queryKey: boardKeys.cards(boardId),
      });
      void queryClient.invalidateQueries({
        queryKey: boardKeys.columns(boardId),
      });
    },
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
