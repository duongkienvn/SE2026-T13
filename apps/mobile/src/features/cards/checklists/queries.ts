import { onlineManager, queryOptions } from '@tanstack/react-query';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import { hintTargets } from '../../../infrastructure/realtime/reconciliation.ts';
import type { KanbanBoard } from '../../boards/kanban-api.ts';
import { isUncertainColumnWrite } from '../../columns/mutations.ts';
import type { Card } from '../decoder.ts';
import { moveAnchor, type CardPlacement } from '../ordering.ts';
import {
  createChecklistApi,
  MAX_CHECKLISTS,
  MAX_ITEMS,
  type CardChecklists,
  type ChecklistCommand,
} from './api.ts';

type Scope = { identity: SessionIdentity; boardId: string; cardId: string };
type ChecklistTarget = { checklistId: string; itemId?: string };
type Move = ChecklistTarget & {
  kind: 'place';
  placement: CardPlacement;
  shown: readonly string[];
};
type Toggle = {
  kind: 'toggle';
  checklistId: string;
  itemId: string;
  intent: () => boolean;
};
export type ChecklistWrite =
  | Exclude<ChecklistCommand, { kind: 'move' | 'moveItem' | 'toggle' }>
  | Move
  | Toggle;

export function checklistOptions(
  data: MobileDataLayer,
  { identity, boardId, cardId }: Scope,
) {
  const api = createChecklistApi(data.api, identity, boardId, cardId);
  return queryOptions({
    queryKey: queryKeys.checklists(identity, boardId, cardId),
    queryFn: ({ signal }) => api.list(signal),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
}

export function checklistRows(list: CardChecklists, target: ChecklistTarget) {
  return target.itemId
    ? (list.checklists.find(({ id }) => id === target.checklistId)?.items ?? [])
    : list.checklists;
}

function rejected(status: number, code: string, message: string): never {
  throw new ApiError('http', { status, code, message });
}
function changed(): never {
  return rejected(
    409,
    'CHECKLIST_CHANGED',
    'The checklist changed. Review the latest version before trying again.',
  );
}
export const isUncertainCreate = isUncertainColumnWrite;

function checkTarget(list: CardChecklists, command: ChecklistWrite) {
  if (command.kind === 'create') {
    if (list.checklists.length >= MAX_CHECKLISTS)
      rejected(400, 'CHECKLIST_LIMIT', 'This card already has 50 checklists.');
    return;
  }
  const checklist = list.checklists.find(
    ({ id }) => id === command.checklistId,
  );
  if (!checklist) return changed();
  if (command.kind === 'addItem' && checklist.items.length >= MAX_ITEMS)
    rejected(
      400,
      'CHECKLIST_ITEM_LIMIT',
      'This checklist already has 200 items.',
    );
  if (
    'itemId' in command &&
    command.itemId &&
    !checklist.items.some(({ id }) => id === command.itemId)
  )
    changed();
}

const writes = new WeakMap<MobileDataLayer, Set<string>>();

/** One batch per Card; the active checkbox can replace its intended value while saving. */
export async function runChecklistWrite(
  data: MobileDataLayer,
  scope: Scope,
  write: ChecklistWrite,
  allowed: () => boolean,
  signal: AbortSignal,
  onSettling?: () => void,
) {
  const { identity, boardId, cardId } = scope;
  const key = queryKeys.checklists(identity, boardId, cardId);
  const boardKey = queryKeys.board(identity, boardId);
  const cardKey = queryKeys.card(identity, boardId, cardId);
  data.assertCurrent(identity);
  const current = data.resources.capture(key, true);
  const guard = () => {
    data.assertCurrent(identity);
    current();
    if (signal.aborted)
      throw new ApiError('aborted', { requestStarted: false });
    if (!onlineManager.isOnline())
      throw new ApiError('offline', { requestStarted: false });
    const board = data.queryClient.getQueryData<KanbanBoard>(boardKey);
    const card = data.queryClient.getQueryData<Card>(cardKey);
    if (
      !allowed() ||
      !board?.capabilities.canWriteBoard ||
      board.isArchived ||
      !card ||
      card.isArchived
    )
      rejected(403, 'CHECKLIST_WRITE_UNAVAILABLE', 'Checklists are read-only.');
  };
  guard();
  const lock = JSON.stringify(key);
  const pending = writes.get(data) ?? new Set<string>();
  writes.set(data, pending);
  if (pending.has(lock))
    rejected(
      409,
      'CHECKLIST_PENDING',
      'Wait for the checklist change to finish.',
    );
  pending.add(lock);

  const api = createChecklistApi(data.api, identity, boardId, cardId);
  const targets = hintTargets(identity, 'card:updated', {
    boardId,
    cardId,
    changeScope: 'checklists',
  });
  try {
    const snapshot = data.queryClient.getQueryData<CardChecklists>(key);
    if (!snapshot) return changed();
    checkTarget(snapshot, write);
    if (write.kind === 'place') {
      // A previously displayed order may be stale even before a socket hint arrives.
      const latest = await api.list(signal);
      guard();
      const actual = checklistRows(latest, write).map(({ id }) => id);
      if (
        actual.length !== write.shown.length ||
        actual.some((id, i) => write.shown[i] !== id)
      )
        return changed();
      checkTarget(latest, write);
      const source = write.itemId ?? write.checklistId;
      const before = moveAnchor(actual, source, write.placement);
      if (before === undefined) return;
      if (write.itemId)
        await api.write(
          {
            kind: 'moveItem',
            checklistId: write.checklistId,
            itemId: write.itemId,
            beforeItemId: before,
          },
          signal,
        );
      else
        await api.write(
          {
            kind: 'move',
            checklistId: write.checklistId,
            beforeChecklistId: before,
          },
          signal,
        );
    } else if (write.kind === 'toggle') {
      const { checklistId, itemId } = write;
      // Read intent synchronously before each request. Ignore intermediate snapshots
      // for display, and never replay a batch after an uncertain failure.
      for (;;) {
        guard();
        const checked = write.intent();
        const result = await api.write(
          { kind: 'toggle', checklistId, itemId, isChecked: checked },
          signal,
        );
        if (
          !result ||
          result.items.find(({ id }) => id === itemId)?.isChecked !== checked
        )
          throw new ApiError('invalid-response', {
            status: 200,
            requestStarted: true,
          });
        current();
        if (checked === write.intent()) break;
      }
    } else {
      await api.write(write, signal);
    }
    data.assertCurrent(identity);
    current();
  } catch (error) {
    if (
      error instanceof ApiError &&
      sameIdentity(identity, data.getIdentity()) &&
      data.resources.readable(boardKey)
    ) {
      if (['CARD_ARCHIVED', 'CARD_NOT_FOUND'].includes(error.code))
        void data.queryClient.invalidateQueries({
          queryKey: cardKey,
          exact: true,
        });
      if (error.code === 'BOARD_ARCHIVED')
        void data.queryClient.invalidateQueries({
          queryKey: boardKey,
          exact: true,
        });
    }
    throw error;
  } finally {
    onSettling?.();
    try {
      if (
        sameIdentity(identity, data.getIdentity()) &&
        data.resources.readable(key)
      ) {
        // Drop in-flight pre-write snapshots (including affected preview batches).
        // REST alone replaces their data; no parent Card text or Board list is patched.
        await Promise.all(
          targets.map((queryKey) =>
            data.queryClient.cancelQueries({ queryKey }),
          ),
        );
        await data.invalidate(identity, targets).catch(() => undefined);
      }
    } finally {
      pending.delete(lock);
    }
  }
}
