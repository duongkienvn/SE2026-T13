import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { isApiError } from '../../../lib/api-client';
import { retryUnlessClientError } from '../../../lib/query-client';
import { useAuth } from '../../auth/useAuth';
import { boardAccessVersion } from '../../boards/access-version';
import { boardKeys } from '../../boards/query-keys';
import { CARD_ARCHIVED } from '../hooks';
import {
  listChecklists,
  runChecklistAction,
  type CardChecklists,
  type Checklist,
  type ChecklistAction,
  type ChecklistItem,
} from './api';

/** Under the card's key, so `card:updated` and access loss reach it too. */
export const checklistKeys = {
  card: (boardId: string, cardId: string) =>
    [...boardKeys.card(boardId, cardId), 'checklists'] as const,
};

/** Codes after which the shown checklist is stale and must be refetched. */
export const STALE_CHECKLIST_CODES = [
  'CHECKLIST_NOT_FOUND',
  'CHECKLIST_ITEM_NOT_FOUND',
  'CHECKLIST_ANCHOR_NOT_FOUND',
  'INVALID_CHECKLIST_MOVE',
];

const percentage = (checked: number, total: number) =>
  total === 0 ? 0 : Math.round((checked * 10000) / total) / 100;

function withItems(checklist: Checklist, items: ChecklistItem[]): Checklist {
  const checked = items.filter((item) => item.isChecked).length;
  return {
    ...checklist,
    items,
    checkedItems: checked,
    totalItems: items.length,
    completionPercentage: percentage(checked, items.length),
  };
}

/** Aggregates recomputed from the (server) checklists, never stored apart. */
export function withChecklists(
  data: CardChecklists,
  checklists: Checklist[],
): CardChecklists {
  const checked = checklists.reduce((sum, row) => sum + row.checkedItems, 0);
  const total = checklists.reduce((sum, row) => sum + row.totalItems, 0);
  return {
    ...data,
    checklists,
    checkedItems: checked,
    totalItems: total,
    completionPercentage: percentage(checked, total),
  };
}

function moveBefore<T extends { id: string }>(
  rows: T[],
  id: string,
  beforeId: string | null,
): T[] {
  const moving = rows.find((row) => row.id === id);
  if (!moving) return rows;
  const rest = rows.filter((row) => row.id !== id);
  const index =
    beforeId === null ? rest.length : rest.findIndex((r) => r.id === beforeId);
  if (index < 0) return rows;
  rest.splice(index, 0, moving);
  return rest;
}

/**
 * The instant, local preview of an action. Only order and checked state are
 * predicted; everything else waits for the server's answer.
 */
export function previewChecklistAction(
  data: CardChecklists,
  action: ChecklistAction,
): CardChecklists {
  const mapChecklist = (
    checklistId: string,
    change: (checklist: Checklist) => Checklist,
  ) =>
    withChecklists(
      data,
      data.checklists.map((row) =>
        row.id === checklistId ? change(row) : row,
      ),
    );
  switch (action.type) {
    case 'toggleItem':
      return mapChecklist(action.checklistId, (row) =>
        withItems(
          row,
          row.items.map((item) =>
            item.id === action.itemId
              ? { ...item, isChecked: action.isChecked }
              : item,
          ),
        ),
      );
    case 'deleteItem':
      return mapChecklist(action.checklistId, (row) =>
        withItems(
          row,
          row.items.filter((item) => item.id !== action.itemId),
        ),
      );
    case 'moveItem':
      return mapChecklist(action.checklistId, (row) =>
        withItems(
          row,
          moveBefore(row.items, action.itemId, action.beforeItemId),
        ),
      );
    case 'delete':
      return withChecklists(
        data,
        data.checklists.filter((row) => row.id !== action.checklistId),
      );
    case 'move':
      return withChecklists(
        data,
        moveBefore(
          data.checklists,
          action.checklistId,
          action.beforeChecklistId,
        ),
      );
    default:
      return data;
  }
}

/** Stores a checklist returned by the server (new or changed). */
export function storeChecklist(
  data: CardChecklists,
  checklist: Checklist,
): CardChecklists {
  const exists = data.checklists.some((row) => row.id === checklist.id);
  return withChecklists(
    data,
    exists
      ? data.checklists.map((row) =>
          row.id === checklist.id ? checklist : row,
        )
      : [...data.checklists, checklist],
  );
}

export function useChecklists(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: checklistKeys.card(boardId, cardId),
    queryFn: ({ signal }) =>
      runAuthorized((token) => listChecklists(token, boardId, cardId, signal)),
    retry: retryUnlessClientError,
  });
}

function pendingCount(client: QueryClient, boardId: string, cardId: string) {
  return client.isMutating({
    mutationKey: checklistKeys.card(boardId, cardId),
  });
}

/** One request at a time per card, so rapid toggles reach the server in order. */
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) ?? Promise.resolve())
    .catch(() => undefined)
    .then(task);
  queues.set(id, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (queues.get(id) === next) queues.delete(id);
    });
  return next;
}

/**
 * `run` shows an action in the cache at once (so a second click already sees
 * the first), then sends it after any earlier action of this card. The
 * server's answer is kept only when nothing else is queued; the last action,
 * or any failure, refetches the authoritative checklists.
 */
export function useChecklistAction(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const client = useQueryClient();
  const key = checklistKeys.card(boardId, cardId);
  const refresh = () =>
    client.invalidateQueries({ queryKey: key, exact: true });
  const mutation = useMutation({
    mutationKey: key,
    meta: { realtimeProtectedKey: key },
    mutationFn: (action: ChecklistAction) =>
      enqueue(key.join(':'), () =>
        runAuthorized((token) =>
          runChecklistAction(token, boardId, cardId, action),
        ),
      ),
    onMutate: () => boardAccessVersion(client, boardId),
    onSuccess: (checklist, _action, version) => {
      if (version !== boardAccessVersion(client, boardId)) return;
      if (checklist && pendingCount(client, boardId, cardId) <= 1)
        client.setQueryData<CardChecklists>(key, (data) =>
          data ? storeChecklist(data, checklist) : data,
        );
    },
    onError: (error) => {
      if (isApiError(error) && error.code === CARD_ARCHIVED)
        void client.invalidateQueries({
          queryKey: boardKeys.card(boardId, cardId),
        });
      void refresh();
    },
    onSettled: () => {
      if (pendingCount(client, boardId, cardId) <= 1) {
        void refresh();
        void client.invalidateQueries({
          queryKey: [...boardKeys.cards(boardId), 'preview-summaries'],
        });
      }
    },
  });
  const run = (requested: ChecklistAction) => {
    let action = requested;
    if (action.type === 'toggleItem') {
      // A toggle flips what the cache shows now, which already includes
      // earlier clicks that have not been rendered or sent yet.
      const { checklistId, itemId } = action;
      const shown = client
        .getQueryData<CardChecklists>(key)
        ?.checklists.find((row) => row.id === checklistId)
        ?.items.find((item) => item.id === itemId);
      if (shown) action = { ...action, isChecked: !shown.isChecked };
    }
    // A refetch already on its way would overwrite the preview.
    void client.cancelQueries(
      { queryKey: key, exact: true },
      { revert: false },
    );
    client.setQueryData<CardChecklists>(key, (data) =>
      data ? previewChecklistAction(data, action) : data,
    );
    return mutation.mutateAsync(action);
  };
  return { run, isPending: mutation.isPending };
}

/** Plain-language feedback for a failed checklist action. */
export function checklistErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (STALE_CHECKLIST_CODES.includes(error.code))
      return 'This checklist changed in the meantime. The latest version is shown.';
    if (error.code === 'CHECKLIST_LIMIT_REACHED')
      return 'Limit reached: a card holds up to 50 checklists of up to 200 items each.';
    if (error.code === CARD_ARCHIVED)
      return 'This card was archived, so its checklists can no longer change.';
    if (error.status === 429)
      return 'Too many changes at once. Wait a moment and try again.';
    if (error.status === 0)
      return 'You appear to be offline. Your change was not saved.';
    if (error.status === 403 || error.status === 404)
      return 'You no longer have permission to change this card.';
    if (error.code === 'VALIDATION_FAILED')
      return 'Check the text: titles take 1–120 characters and items 1–255.';
  }
  return 'The change was not saved. Try again.';
}
