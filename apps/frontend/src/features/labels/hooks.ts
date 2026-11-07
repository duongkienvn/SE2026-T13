import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../lib/api-client';
import { retryUnlessClientError } from '../../lib/query-client';
import { useAuth } from '../auth/useAuth';
import { boardAccessVersion } from '../boards/access-version';
import { boardKeys } from '../boards/query-keys';
import { previewSummaryFilters } from '../cards/preview-summary-cache';
import {
  assignLabel,
  createLabel,
  deleteLabel,
  listCardLabels,
  listLabels,
  unassignLabel,
  updateLabel,
  type CardLabels,
  type LabelInput,
} from './api';

/**
 * The catalog sits under the board detail, the assignments under the card,
 * so access loss clears both and `card:updated` refreshes a card's labels.
 */
export const labelKeys = {
  catalog: (boardId: string) =>
    [...boardKeys.detail(boardId), 'labels'] as const,
  card: (boardId: string, cardId: string) =>
    [...boardKeys.card(boardId, cardId), 'labels'] as const,
};

export function useLabelCatalog(boardId: string, { enabled = true } = {}) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: labelKeys.catalog(boardId),
    queryFn: ({ signal }) =>
      runAuthorized((token) => listLabels(token, boardId, signal)),
    retry: retryUnlessClientError,
    enabled,
  });
}

export function useCardLabels(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: labelKeys.card(boardId, cardId),
    queryFn: ({ signal }) =>
      runAuthorized((token) => listCardLabels(token, boardId, cardId, signal)),
    retry: retryUnlessClientError,
  });
}

/** A catalog change shows on every card of the board that uses the label. */
function useInvalidateLabels(boardId: string) {
  const client = useQueryClient();
  const cards = boardKeys.cards(boardId);
  return () => {
    void client.invalidateQueries({ queryKey: [...cards, 'filtered'] });
    void client.invalidateQueries({
      queryKey: [...cards, 'preview-summaries'],
    });
    return Promise.all([
      client.invalidateQueries({ queryKey: labelKeys.catalog(boardId) }),
      client.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey.at(-1) === 'labels' &&
          cards.every((part, index) => queryKey[index] === part),
      }),
    ]);
  };
}

export function useCreateLabel(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateLabels(boardId);
  return useMutation({
    mutationFn: (input: LabelInput) =>
      runAuthorized((token) => createLabel(token, boardId, input)),
    onSettled: invalidate,
  });
}

export function useUpdateLabel(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateLabels(boardId);
  return useMutation({
    mutationFn: ({
      labelId,
      ...input
    }: Partial<LabelInput> & { labelId: string }) =>
      runAuthorized((token) => updateLabel(token, boardId, labelId, input)),
    onSettled: invalidate,
  });
}

export function useDeleteLabel(boardId: string) {
  const { runAuthorized } = useAuth();
  const invalidate = useInvalidateLabels(boardId);
  return useMutation({
    mutationFn: (labelId: string) =>
      runAuthorized((token) => deleteLabel(token, boardId, labelId)),
    onSettled: invalidate,
  });
}

/** Assign or unassign one label on one card; never touches the catalog. */
export function useToggleCardLabel(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const client = useQueryClient();
  const key = labelKeys.card(boardId, cardId);
  return useMutation({
    mutationFn: ({
      labelId,
      assign,
    }: {
      labelId: string;
      assign: boolean;
    }): Promise<CardLabels | void> =>
      runAuthorized<CardLabels | void>((token) =>
        assign
          ? assignLabel(token, boardId, cardId, labelId)
          : unassignLabel(token, boardId, cardId, labelId),
      ),
    onMutate: () => boardAccessVersion(client, boardId),
    onSuccess: (result: CardLabels | void, _input, version) => {
      if (result && version === boardAccessVersion(client, boardId))
        client.setQueryData(key, result);
    },
    onError: (error) => {
      // A deleted label or a stale assignment: refresh what is offered.
      if (isApiError(error) && [404, 409].includes(error.status))
        void client.invalidateQueries({
          queryKey: labelKeys.catalog(boardId),
        });
    },
    onSettled: () => {
      void client.invalidateQueries({
        queryKey: [...boardKeys.cards(boardId), 'filtered'],
      });
      void client.invalidateQueries(previewSummaryFilters(boardId, cardId));
      return client.invalidateQueries({ queryKey: key, exact: true });
    },
  });
}

export function labelErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'LABEL_NAME_EXISTS':
        return 'A label with this name already exists on this board.';
      case 'LABEL_LIMIT_REACHED':
        return 'This board already has 200 labels. Delete one to add another.';
      case 'CARD_LABEL_EXISTS':
        return 'This label is already on the card.';
      case 'LABEL_NOT_FOUND':
      case 'CARD_LABEL_NOT_FOUND':
        return 'That label was changed or deleted. The latest labels are shown.';
      case 'CARD_ARCHIVED':
        return 'This card was archived, so its labels can no longer change.';
      case 'BOARD_ARCHIVED':
        return 'This board has been archived, so labels can no longer change.';
    }
    if (error.status === 403 || error.status === 404)
      return 'You no longer have permission to change labels here.';
    if (error.status === 429)
      return 'Too many changes at once. Wait a moment and try again.';
    if (error.status === 0)
      return 'You appear to be offline. The change was not saved.';
    if (error.code === 'VALIDATION_FAILED')
      return 'Use a name of 1–120 characters and one of the colors shown.';
  }
  return 'The change was not saved. Try again.';
}
