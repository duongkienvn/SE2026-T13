import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import {
  queryKeys,
  type PrivateQueryKey,
} from '../../../infrastructure/query/keys.ts';
import { createKanbanApi, type KanbanBoard } from '../../boards/kanban-api.ts';
import { canMutateColumns } from '../../columns/mutations.ts';
import { createCardApi } from '../api.ts';
import type { Card } from '../decoder.ts';
import { cardTargets } from '../mutations.ts';
import { createMetadataApi, type LabelFields } from './api.ts';
import { dateRangeError, type DateField } from './dates.ts';

export type MetadataCommand =
  | {
      kind:
        | 'assignMember'
        | 'unassignMember'
        | 'assignLabel'
        | 'unassignLabel'
        | 'deleteLabel';
      id: string;
    }
  | { kind: 'createLabel'; fields: LabelFields }
  | { kind: 'updateLabel'; id: string; fields: Partial<LabelFields> }
  | {
      kind: 'date';
      field: DateField;
      value: string | null;
      original: string | null;
      zone: string;
    };

const writes = new WeakMap<MobileDataLayer, Set<string>>();

function unavailable() {
  return new ApiError('http', {
    status: 403,
    code: 'METADATA_WRITE_UNAVAILABLE',
  });
}

export function metadataTargets(
  identity: SessionIdentity,
  boardId: string,
  cardId: string,
  kind: MetadataCommand['kind'],
): PrivateQueryKey[] {
  const keys = cardTargets(identity, boardId, [cardId]);
  const board = queryKeys.board(identity, boardId);
  if (
    kind === 'createLabel' ||
    kind === 'updateLabel' ||
    kind === 'deleteLabel'
  ) {
    return [
      ...keys,
      queryKeys.labels(identity, boardId),
      [...board, 'cards'],
      [...board, 'previews'],
    ];
  }
  if (kind === 'assignMember' || kind === 'unassignMember')
    return [...keys, queryKeys.members(identity, boardId)];
  if (kind === 'assignLabel' || kind === 'unassignLabel')
    return [...keys, queryKeys.labels(identity, boardId)];
  return keys;
}

export async function runMetadataMutation(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  cardId: string,
  command: MetadataCommand,
  signal: AbortSignal,
) {
  data.assertCurrent(identity);
  if (signal.aborted) throw new ApiError('aborted');
  if (!onlineManager.isOnline()) throw new ApiError('offline');

  const boardKey = queryKeys.board(identity, boardId);
  const cardKey = queryKeys.card(identity, boardId, cardId);
  const current = data.resources.capture(cardKey, true);
  const card = data.queryClient.getQueryData<Card>(cardKey);
  if (
    !canMutateColumns(data.queryClient.getQueryData<KanbanBoard>(boardKey)) ||
    !card ||
    card.isArchived
  )
    throw unavailable();

  const lock = JSON.stringify(boardKey);
  const pending = writes.get(data) ?? new Set<string>();
  writes.set(data, pending);
  if (pending.has(lock))
    throw new ApiError('http', {
      status: 409,
      code: 'METADATA_PENDING',
      message: 'A metadata change is already saving.',
    });

  const api = createMetadataApi(data.api, identity, boardId, cardId);
  const cards = createCardApi(data.api, identity, boardId);
  const targets = metadataTargets(identity, boardId, cardId, command.kind);
  pending.add(lock);
  let reconcile = true;
  try {
    switch (command.kind) {
      case 'date': {
        const { field, original, value, zone } = command;
        if (card[field] === value) {
          reconcile = false;
          return;
        }
        if (card[field] !== original)
          throw new ApiError('http', {
            status: 409,
            code: 'METADATA_DATE_CHANGED',
            message:
              'This date changed. Close and reopen the editor to review it.',
          });
        const error = dateRangeError(
          field,
          value,
          card[field === 'startDate' ? 'dueDate' : 'startDate'],
        );
        if (error)
          throw new ApiError('http', {
            status: 400,
            code: 'CARD_DATE_RANGE_INVALID',
            message: error,
          });
        if (value !== null) {
          const preferences = await createKanbanApi(
            data.api,
            identity,
            boardId,
          ).datePreferences(signal);
          data.assertCurrent(identity);
          current();
          if (signal.aborted) throw new ApiError('aborted');
          if (preferences.timeZone !== zone) {
            void data
              .invalidate(identity, [queryKeys.datePreferences(identity)])
              .catch(() => undefined);
            throw new ApiError('http', {
              status: 409,
              code: 'METADATA_ZONE_CHANGED',
              message:
                'Your time zone changed. Close and reopen the date editor.',
            });
          }
        }
        const result = await cards.update(cardId, { [field]: value }, signal);
        if (result[field] !== value)
          throw new ApiError('http', {
            status: 409,
            code: 'METADATA_DATE_UNCONFIRMED',
            message:
              'The saved date wasn’t confirmed. Review the updated card and try again.',
          });
        break;
      }
      case 'assignMember':
        await api.assignMember(command.id, signal);
        break;
      case 'unassignMember':
        await api.unassignMember(command.id, signal);
        break;
      case 'assignLabel':
        await api.assignLabel(command.id, signal);
        break;
      case 'unassignLabel':
        await api.unassignLabel(command.id, signal);
        break;
      case 'createLabel':
      case 'updateLabel':
      case 'deleteLabel': {
        // Label catalog endpoints are Board-scoped. Recheck the Card before using
        // one through the Card Detail entry point, including after an archive hint.
        if ((await cards.getCard(cardId, signal)).isArchived)
          throw unavailable();
        if (command.kind === 'createLabel')
          await api.createLabel(command.fields, signal);
        else if (command.kind === 'updateLabel')
          await api.updateLabel(command.id, command.fields, signal);
        else await api.deleteLabel(command.id, signal);
        break;
      }
    }
    data.assertCurrent(identity);
    current();
  } catch (error) {
    if (
      error instanceof ApiError &&
      [403, 404].includes(error.status) &&
      sameIdentity(identity, data.getIdentity()) &&
      data.resources.readable(boardKey)
    ) {
      // Refresh the Board capability displayed by the screen after a child denial.
      void data.queryClient.invalidateQueries({
        queryKey: boardKey,
        exact: true,
      });
    }
    throw error;
  } finally {
    try {
      if (
        reconcile &&
        sameIdentity(identity, data.getIdentity()) &&
        data.resources.readable(boardKey)
      ) {
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
