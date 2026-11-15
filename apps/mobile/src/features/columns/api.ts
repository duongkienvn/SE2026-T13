import { ApiError, invalidResponse } from '../../infrastructure/api/errors.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { isUuid } from '../../infrastructure/auth/credential-record.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import {
  createKanbanApi,
  decodeKanbanColumn,
  type KanbanColumn,
} from '../boards/kanban-api.ts';

export type Column = KanbanColumn;
export const decodeColumn = decodeKanbanColumn;
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function columnName(value: string) {
  const name = value.trim();
  const message = !name
    ? 'Enter a column name.'
    : [...name].length > 120
      ? 'Column name must be at most 120 characters.'
      : undefined;
  if (message)
    throw new ApiError('http', {
      status: 400,
      code: 'VALIDATION_FAILED',
      message,
    });
  return name;
}

export function createColumnApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
) {
  if (!isUuid(boardId)) throw new Error('Invalid Board ID');
  const id = boardId.toLowerCase();
  const base = `/boards/${id}/columns`;
  const key = queryKeys.columns(identity, id);
  const writeOptions = (signal: AbortSignal, target: string) => ({
    identity,
    signal,
    resourceKey: [...key, 'write', target] as const,
    retries: 0 as const,
  });
  const itemPath = (columnId: string) => {
    if (!isUuid(columnId)) throw new Error('Invalid Column ID');
    return `${base}/${columnId.toLowerCase()}`;
  };
  const decode = (status: number, target?: string) => (value: unknown) => {
    const column = decodeColumn(value, id);
    if (target && column.id !== target.toLowerCase())
      throw invalidResponse(status);
    return column;
  };

  return {
    list: createKanbanApi(api, identity, id).columns,
    create: (value: string, signal: AbortSignal) =>
      api.json(base, decode(201), {
        ...writeOptions(signal, 'create'),
        method: 'POST',
        expectedStatus: 201,
        body: { name: columnName(value) },
      }),
    rename: (columnId: string, value: string, signal: AbortSignal) =>
      api.json(itemPath(columnId), decode(200, columnId), {
        ...writeOptions(signal, columnId),
        method: 'PATCH',
        expectedStatus: 200,
        body: { name: columnName(value) },
      }),
    move: (
      columnId: string,
      beforeColumnId: string | null,
      signal: AbortSignal,
    ) => {
      if (
        beforeColumnId !== null &&
        (typeof beforeColumnId !== 'string' ||
          !uuidV4.test(beforeColumnId) ||
          beforeColumnId.toLowerCase() === columnId.toLowerCase())
      )
        throw new ApiError('http', {
          status: 400,
          code: 'INVALID_COLUMN_MOVE',
          message: 'Choose a different column position.',
        });
      return api.json(`${itemPath(columnId)}/move`, decode(200, columnId), {
        ...writeOptions(signal, columnId),
        method: 'PATCH',
        expectedStatus: 200,
        body: { beforeColumnId: beforeColumnId?.toLowerCase() ?? null },
      });
    },
    remove: (columnId: string, signal: AbortSignal) =>
      api.empty(itemPath(columnId), {
        ...writeOptions(signal, columnId),
        method: 'DELETE',
      }),
  };
}
