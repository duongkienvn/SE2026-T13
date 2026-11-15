import { onlineManager, type InfiniteData } from '@tanstack/react-query';
import type { ApiPaginatedResponse } from '@kanban/shared';
import { ApiError } from '../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import {
  compareKanbanPosition,
  kanbanCollection,
} from '../boards/kanban-model.ts';
import type { KanbanBoard } from '../boards/kanban-api.ts';
import { columnName, createColumnApi, type Column } from './api.ts';

export function canMutateColumns(
  board:
    | {
        isArchived: boolean;
        capabilities: { canReadBoard: boolean; canWriteBoard: boolean };
      }
    | null
    | undefined,
) {
  return (
    !!board &&
    !board.isArchived &&
    board.capabilities.canReadBoard &&
    board.capabilities.canWriteBoard
  );
}

export type ColumnDirection = 'left' | 'right';
/** Undefined is no-op. Null is the server's append anchor. */
export function columnMoveAnchor(
  orderedColumnIds: readonly string[],
  id: string,
  direction: ColumnDirection,
) {
  const index = orderedColumnIds.indexOf(id);
  const next = index + (direction === 'left' ? -1 : 1);
  if (index < 0 || next < 0 || next >= orderedColumnIds.length)
    return undefined;
  const remaining = orderedColumnIds.filter((other) => other !== id);
  return remaining[next] ?? null;
}

export type ColumnCommand =
  | { kind: 'create'; name: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'move'; id: string; direction: ColumnDirection }
  | { kind: 'remove'; id: string };

export type ColumnMutationResult =
  | { kind: 'created' | 'renamed' | 'moved'; column: Column }
  | { kind: 'removed'; id: string }
  | { kind: 'unchanged' };

const pendingByLayer = new WeakMap<MobileDataLayer, Set<string>>();

export function columnWriteNeedsAccessCheck(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 403 ||
      (error.status === 404 && error.code !== 'COLUMN_NOT_FOUND') ||
      error.code === 'BOARD_ARCHIVED')
  );
}

export function isUncertainColumnWrite(error: unknown) {
  return (
    error instanceof ApiError &&
    ([
      'timeout',
      'network',
      'invalid-response',
      'aborted',
      'session-changed',
    ].includes(error.kind) ||
      error.status >= 500)
  );
}

export async function runColumnMutation(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  command: ColumnCommand,
  signal: AbortSignal,
): Promise<ColumnMutationResult> {
  data.assertCurrent(identity);
  if (!onlineManager.isOnline()) throw new ApiError('offline');
  const board = data.queryClient.getQueryData<KanbanBoard>(
    queryKeys.board(identity, boardId),
  );
  if (!canMutateColumns(board))
    throw new ApiError('http', {
      status: 403,
      code: 'COLUMN_WRITE_UNAVAILABLE',
    });
  const key = queryKeys.columns(identity, boardId);
  const lockId = JSON.stringify(key);
  const locks = pendingByLayer.get(data) ?? new Set<string>();
  pendingByLayer.set(data, locks);
  if (locks.has(lockId))
    throw new ApiError('http', {
      status: 409,
      code: 'COLUMN_WRITE_PENDING',
      message: 'A column change is already saving.',
    });
  const current = data.resources.capture(key, true);
  locks.add(lockId);
  let refresh = false;
  let removed = false;
  try {
    const api = createColumnApi(data.api, identity, boardId);
    if (command.kind === 'create') {
      const name = columnName(command.name);
      refresh = true;
      return { kind: 'created', column: await api.create(name, signal) };
    }
    const query =
      data.queryClient.getQueryState<
        InfiniteData<ApiPaginatedResponse<Column>>
      >(key);
    const collection = kanbanCollection(query?.data?.pages ?? []);
    const column = collection.items.find(({ id }) => id === command.id);
    if (!column) {
      refresh = true;
      throw new ApiError('http', {
        status: 404,
        code: 'COLUMN_NOT_FOUND',
        message: 'This column is no longer available.',
      });
    }
    switch (command.kind) {
      case 'rename': {
        const name = columnName(command.name);
        if (column.name === name) return { kind: 'unchanged' };
        refresh = true;
        return {
          kind: 'renamed',
          column: await api.rename(column.id, name, signal),
        };
      }
      case 'move': {
        if (
          !collection.complete ||
          query?.status !== 'success' ||
          query.fetchStatus !== 'idle' ||
          query.isInvalidated
        )
          throw new ApiError('http', {
            status: 409,
            code: 'COLUMN_ORDER_LOADING',
            message: 'Load the latest columns before moving this column.',
          });
        const ordered = collection.items
          .sort(compareKanbanPosition)
          .map(({ id }) => id);
        const anchor = columnMoveAnchor(ordered, column.id, command.direction);
        if (anchor === undefined) return { kind: 'unchanged' };
        refresh = true;
        return {
          kind: 'moved',
          column: await api.move(column.id, anchor, signal),
        };
      }
      default:
        refresh = true;
        await api.remove(column.id, signal);
        removed = true;
        return { kind: 'removed', id: column.id };
    }
  } finally {
    try {
      if (
        refresh &&
        sameIdentity(identity, data.getIdentity()) &&
        data.resources.readable(key)
      ) {
        const affected = removed
          ? [key, queryKeys.cards(identity, boardId)]
          : [key];
        // An in-flight page read can predate the write, including a first-page read with no data yet.
        await Promise.all(
          affected.map((queryKey) =>
            data.queryClient.cancelQueries({ queryKey }),
          ),
        );
        await data.invalidate(identity, affected).catch(() => undefined);
      }
    } finally {
      locks.delete(lockId);
    }
    // A delayed reconciliation must not surface a result in a later session or Board grant.
    data.assertCurrent(identity);
    current();
  }
}
