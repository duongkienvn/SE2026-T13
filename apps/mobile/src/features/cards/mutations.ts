import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import type { KanbanBoard } from '../boards/kanban-api.ts';
import { canMutateColumns } from '../columns/mutations.ts';
import { createCardApi, type CardPatch, type CreateCard } from './api.ts';
import type { Card } from './decoder.ts';
import {
  cardOrderChanged,
  moveAnchor,
  readCardOrder,
  type CardPlacement,
} from './ordering.ts';

export type CardCommand =
  | { kind: 'create'; input: CreateCard }
  | { kind: 'update'; id: string; patch: CardPatch; expectedTitle?: string }
  | { kind: 'duplicate'; id: string; columnId?: string }
  | { kind: 'archive' | 'restore'; id: string }
  | {
      kind: 'move';
      id: string;
      fromColumnId: string;
      toColumnId: string;
      placement: { kind: 'append' } | { kind: CardPlacement; revision: string };
    };

const writes = new WeakMap<MobileDataLayer, Set<string>>();

export function cardTargets(
  identity: SessionIdentity,
  boardId: string,
  ids: readonly string[],
) {
  return [
    queryKeys.cards(identity, boardId),
    ...[...new Set(ids)].flatMap((id) => [
      queryKeys.card(identity, boardId, id),
      queryKeys.cardPreview(identity, boardId, id),
      queryKeys.previewBatch(identity, boardId, [id]),
    ]),
    queryKeys.home(identity),
    queryKeys.tasks(identity),
    queryKeys.search(identity),
  ];
}

export async function reconcileCards(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  ids: readonly string[],
) {
  const keys = cardTargets(identity, boardId, ids);
  await Promise.all(
    keys.map((queryKey) => data.queryClient.cancelQueries({ queryKey })),
  );
  await data.invalidate(identity, keys);
}

export async function runCardMutation(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  command: CardCommand,
  signal: AbortSignal,
): Promise<Card | null> {
  data.assertCurrent(identity);
  if (!onlineManager.isOnline()) throw new ApiError('offline');
  const boardKey = queryKeys.board(identity, boardId);
  if (!canMutateColumns(data.queryClient.getQueryData<KanbanBoard>(boardKey)))
    throw new ApiError('http', { status: 403, code: 'CARD_WRITE_UNAVAILABLE' });
  const key = queryKeys.cards(identity, boardId);
  const current = data.resources.capture(key, true);
  const api = createCardApi(data.api, identity, boardId);
  const lock = JSON.stringify(key);
  const pending = writes.get(data) ?? new Set<string>();
  writes.set(data, pending);
  if (pending.has(lock))
    throw new ApiError('http', {
      status: 409,
      code: 'CARD_WRITE_PENDING',
      message: 'A card change is already saving.',
    });
  pending.add(lock);
  const ids = 'id' in command ? [command.id] : [];
  let refresh = false;
  try {
    let result: Card;
    switch (command.kind) {
      case 'create':
        result = await api.create(command.input, signal);
        break;
      case 'update': {
        if (command.expectedTitle !== undefined) {
          const latest = await api.getCard(command.id, signal);
          if (latest.isArchived || latest.title !== command.expectedTitle)
            throw new ApiError('http', {
              status: 409,
              code: 'CARD_TITLE_CHANGED',
              message:
                'This card changed. Keep your draft or reopen Rename to see the latest title.',
            });
        }
        result = await api.update(command.id, command.patch, signal);
        break;
      }
      case 'move': {
        const source = await api.getCard(command.id, signal);
        if (source.isArchived || source.columnId !== command.fromColumnId)
          throw cardOrderChanged();
        let beforeCardId: string | null = null;
        if (command.placement.kind !== 'append') {
          const order = await readCardOrder(api, command.toColumnId, signal);
          if (
            order.revision !== command.placement.revision ||
            (source.columnId === command.toColumnId &&
              !order.ids.includes(command.id))
          )
            throw cardOrderChanged();
          const anchor = moveAnchor(
            order.ids,
            command.id,
            command.placement.kind,
          );
          if (anchor === undefined) return null;
          beforeCardId = anchor;
        }
        result = await api.move(
          command.id,
          { toColumnId: command.toColumnId, beforeCardId },
          signal,
        );
        break;
      }
      case 'duplicate':
        result = await api.duplicate(command.id, command.columnId, signal);
        break;
      case 'archive':
        result = await api.archive(command.id, signal);
        break;
      case 'restore':
        result = await api.restore(command.id, signal);
        break;
    }
    ids.push(result.id);
    refresh = true;
    return result;
  } catch (error) {
    refresh = !(
      error instanceof ApiError && error.code === 'INVALID_CARD_INPUT'
    );
    throw error;
  } finally {
    try {
      if (
        refresh &&
        sameIdentity(identity, data.getIdentity()) &&
        data.resources.readable(key)
      )
        await reconcileCards(data, identity, boardId, ids).catch(
          () => undefined,
        );
    } finally {
      pending.delete(lock);
    }
    data.assertCurrent(identity);
    current();
  }
}
