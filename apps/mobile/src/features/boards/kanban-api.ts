import {
  CardDueStatus,
  isCardDateInstant,
  parseCardDateInstant,
  type BoardCardFilters,
  type CardPreviewSummary,
} from '@kanban/shared';
import { ApiError, invalidResponse } from '../../infrastructure/api/errors.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { isUuid } from '../../infrastructure/auth/credential-record.ts';
import {
  queryKeys,
  type PrivateQueryKey,
} from '../../infrastructure/query/keys.ts';
import { requirePage } from '../../infrastructure/query/pagination.ts';
import { decodeBoardAccess } from '../../infrastructure/realtime/rooms.ts';
import { decodeWorkspace } from '../workspaces/decoder.ts';
import { decodeBoard } from './api.ts';
import {
  utcPreferences,
  type DatePreferences,
} from '../cards/metadata/dates.ts';

export type KanbanFilters = Omit<BoardCardFilters, 'page' | 'limit'>;
export const kanbanPageSize = 100;
const v4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeKanbanFilters(filters: KanbanFilters) {
  const q = filters.q?.trim();
  if (q && q.length > 200)
    throw new Error('Search must be 200 characters or fewer.');
  const {
    status = 'active',
    sortBy,
    dueStatus,
    sortDirection,
    columnId,
  } = filters;
  if (status !== 'active' && status !== 'archived')
    throw new Error('Invalid Card status.');
  if (sortBy !== undefined && sortBy !== 'title' && sortBy !== 'dueDate')
    throw new Error('Invalid sort.');
  if (
    sortDirection !== undefined &&
    sortDirection !== 'asc' &&
    sortDirection !== 'desc'
  )
    throw new Error('Invalid sort direction.');
  if (
    dueStatus !== undefined &&
    !Object.values(CardDueStatus).includes(dueStatus)
  )
    throw new Error('Invalid due status.');
  if (columnId !== undefined && !isUuid(columnId))
    throw new Error('Invalid Column.');
  const instant = (value?: string) => {
    if (!value?.trim()) return undefined;
    try {
      return parseCardDateInstant(value.trim()).toISOString();
    } catch {
      throw new Error('Enter a date and time with Z or a UTC offset.');
    }
  };
  const dueFrom = instant(filters.dueFrom);
  const dueTo = instant(filters.dueTo);
  if (dueFrom && dueTo && dueFrom >= dueTo)
    throw new Error('Due before must be later than Due from.');
  const csv = (ids?: string[]) => {
    const unique = [...new Set(ids?.map((id) => id.toLowerCase()))].sort();
    if (unique.length > 50 || unique.some((id) => !v4.test(id)))
      throw new Error('Select up to 50 valid options in each group.');
    return unique.length ? unique.join(',') : undefined;
  };
  return {
    status,
    q: q || undefined,
    labelIds: csv(filters.labelIds),
    assigneeIds: csv(filters.assigneeIds),
    dueStatus,
    dueFrom,
    dueTo,
    columnId: columnId?.toLowerCase(),
    sortBy,
    sortDirection: sortBy ? (sortDirection ?? 'asc') : undefined,
  };
}

export function filterCount(filters: KanbanFilters) {
  return [
    filters.q?.trim(),
    filters.labelIds?.length,
    filters.assigneeIds?.length,
    filters.dueStatus,
    filters.dueFrom?.trim() || filters.dueTo?.trim(),
    filters.columnId,
    filters.sortBy,
    filters.status === 'archived',
  ].filter(Boolean).length;
}

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse(200);
  return value as Record<string, unknown>;
}
function id(value: unknown) {
  if (!isUuid(value)) throw invalidResponse(200);
  return value.toLowerCase();
}
function name(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw invalidResponse(200);
  return value;
}
function position(value: unknown) {
  if (typeof value !== 'string' || !/^-?\d{1,10}(\.\d{1,10})?$/.test(value))
    throw invalidResponse(200);
  return value;
}
function date(value: unknown) {
  if (!isCardDateInstant(value) || !value.endsWith('Z'))
    throw invalidResponse(200);
  return value;
}
function related(value: unknown, boardId: string) {
  const item = row(value);
  if (id(item.boardId) !== boardId) throw invalidResponse(200);
  return item;
}
export function decodeKanbanBoard(value: unknown, boardId: string) {
  const access = decodeBoardAccess(value);
  if (access.id !== boardId) throw invalidResponse(200);
  if (!access.capabilities.canReadBoard) return null;
  const board = decodeBoard(value);
  return { ...board, ...access, capabilities: board.capabilities };
}
export function decodeKanbanColumn(value: unknown, boardId: string) {
  const item = related(value, boardId);
  return {
    id: id(item.id),
    boardId,
    name: name(item.name),
    position: position(item.position),
    createdAt: date(item.createdAt),
    updatedAt: date(item.updatedAt),
  };
}
export function decodeKanbanCard(
  value: unknown,
  boardId: string,
  filters: ReturnType<typeof normalizeKanbanFilters>,
) {
  const item = related(value, boardId);
  const columnId = id(item.columnId);
  if (
    item.isArchived !== (filters.status === 'archived') ||
    (filters.columnId && columnId !== filters.columnId) ||
    !Array.isArray(item.assignees) ||
    (item.description !== null && typeof item.description !== 'string')
  )
    throw invalidResponse(200);
  return {
    id: id(item.id),
    boardId,
    columnId,
    title: name(item.title),
    position: position(item.position),
    isArchived: item.isArchived,
    archivedAt: item.isArchived ? date(item.archivedAt) : null,
    description: item.description,
    startDate: item.startDate === null ? null : date(item.startDate),
    dueDate: item.dueDate === null ? null : date(item.dueDate),
    createdAt: date(item.createdAt),
    updatedAt: date(item.updatedAt),
    assignees: item.assignees.map((value: unknown) => ({
      userId: id(row(value).userId),
    })),
  };
}
export type KanbanColumn = ReturnType<typeof decodeKanbanColumn>;
export type KanbanCard = ReturnType<typeof decodeKanbanCard>;
export type KanbanBoard = NonNullable<ReturnType<typeof decodeKanbanBoard>>;

function count(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalidResponse(200);
  return value;
}
export function decodePreviewBatch(
  value: unknown,
  ids: readonly string[],
): CardPreviewSummary[] {
  const requested = new Set(ids);
  const { summaries } = row(value);
  if (!Array.isArray(summaries) || summaries.length > ids.length)
    throw invalidResponse(200);
  return summaries.map((value: unknown) => {
    const summary = row(value);
    const cardId = id(summary.cardId);
    if (!requested.delete(cardId) || !Array.isArray(summary.labelIds))
      throw invalidResponse(200);
    const checklist = row(summary.checklist);
    const checkedItems = count(checklist.checkedItems);
    const totalItems = count(checklist.totalItems);
    if (checkedItems > totalItems) throw invalidResponse(200);
    return {
      cardId,
      labelIds: [...new Set(summary.labelIds.map(id))],
      checklist: { checkedItems, totalItems },
      attachmentCount: count(summary.attachmentCount),
      commentCount: count(summary.commentCount),
    };
  });
}

export interface KanbanLabel {
  id: string;
  name: string;
  color: string;
}
export interface KanbanAssignee {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export function decodeKanbanLabel(
  value: unknown,
  boardId: string,
  status = 200,
): KanbanLabel {
  const label = value as Record<string, unknown> | null;
  if (
    !isUuid(label?.boardId) ||
    label.boardId.toLowerCase() !== boardId ||
    !isUuid(label.id) ||
    typeof label.name !== 'string' ||
    !label.name.trim() ||
    [...label.name].length > 120 ||
    typeof label.color !== 'string' ||
    !/^#[0-9A-F]{6}$/.test(label.color)
  )
    throw invalidResponse(status);
  return { id: label.id.toLowerCase(), name: label.name, color: label.color };
}

export function isAccessDenied(error: unknown) {
  return (
    error instanceof ApiError && (error.status === 403 || error.status === 404)
  );
}

export function createKanbanApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
) {
  const path = `/boards/${boardId}`;
  const boardKey = queryKeys.board(identity, boardId);
  const options = (signal: AbortSignal, resourceKey?: PrivateQueryKey) => ({
    identity,
    signal,
    resourceKey,
    expectedStatus: 200 as const,
    retries: 0 as const,
  });
  async function readPage<T>(
    endpoint: string,
    key: PrivateQueryKey,
    page: number,
    signal: AbortSignal,
    decode: (value: unknown) => T,
    filters?: ReturnType<typeof normalizeKanbanFilters>,
  ) {
    const limit = kanbanPageSize;
    const result = requirePage(
      await api.envelope(
        `${path}/${endpoint}`,
        (value) => {
          if (!Array.isArray(value) || value.length > limit)
            throw invalidResponse(200);
          return value.map((item: unknown) => decode(item));
        },
        { ...options(signal, key), query: { ...filters, page, limit } },
      ),
    );
    if (
      result.meta.page !== page ||
      result.meta.limit !== limit ||
      result.meta.totalPages !== Math.ceil(result.meta.total / limit)
    )
      throw invalidResponse(200);
    return result;
  }
  // A denied optional catalog is a valid UI state. Let the resource layer
  // schedule Board verification, while keeping independent filters usable.
  async function optional<T>(read: Promise<T>) {
    try {
      return await read;
    } catch (error) {
      if (isAccessDenied(error)) return null;
      throw error;
    }
  }
  return {
    // Access probes cannot use the read grant they are establishing.
    board: (signal: AbortSignal) =>
      api.json(
        path,
        (value) => decodeKanbanBoard(value, boardId),
        options(signal),
      ),
    columns: (page: number, signal: AbortSignal) =>
      readPage(
        'columns',
        queryKeys.columns(identity, boardId),
        page,
        signal,
        (value) => decodeKanbanColumn(value, boardId),
      ),
    cards: (
      filters: ReturnType<typeof normalizeKanbanFilters>,
      page: number,
      signal: AbortSignal,
    ) =>
      readPage(
        'cards',
        queryKeys.cards(identity, boardId, filters),
        page,
        signal,
        (value) => decodeKanbanCard(value, boardId, filters),
        filters,
      ),
    labels: (page: number, signal: AbortSignal) =>
      optional(
        readPage(
          'labels',
          queryKeys.labels(identity, boardId),
          page,
          signal,
          (value) => decodeKanbanLabel(value, boardId),
        ),
      ),
    members: (page: number, signal: AbortSignal) =>
      optional(
        readPage(
          'members',
          queryKeys.members(identity, boardId),
          page,
          signal,
          (value): KanbanAssignee => {
            const user = row(row(value).user);
            return {
              id: id(user.id),
              name: name(user.displayName),
              avatarUrl:
                typeof user.avatarUrl === 'string' &&
                /^https:\/\/[^/\s]+/i.test(user.avatarUrl)
                  ? user.avatarUrl
                  : null,
            };
          },
        ),
      ),
    previews: (ids: readonly string[], signal: AbortSignal) => {
      if (
        !ids.length ||
        ids.length > kanbanPageSize ||
        new Set(ids).size !== ids.length ||
        ids.some((value) => !v4.test(value))
      )
        throw invalidResponse(200);
      return api.json(
        `${path}/card-preview-summaries`,
        (value) => decodePreviewBatch(value, ids),
        {
          ...options(signal, queryKeys.previewBatch(identity, boardId, ids)),
          query: { cardIds: ids.join(',') },
        },
      );
    },
    workspace: (workspaceId: string, signal: AbortSignal) =>
      optional(
        api.json(
          `/workspaces/${workspaceId}`,
          (value) => {
            const workspace = decodeWorkspace(value);
            if (workspace.id !== workspaceId) throw invalidResponse(200);
            return workspace.name;
          },
          options(signal, [...boardKey, 'workspace-context', workspaceId]),
        ),
      ),
    datePreferences: (signal: AbortSignal) =>
      api.json(
        '/users/me/preferences',
        (value): DatePreferences => {
          const {
            timeZone = utcPreferences.timeZone,
            dateFormat = utcPreferences.dateFormat,
          } = row(value);
          if (
            typeof timeZone !== 'string' ||
            !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timeZone) ||
            (dateFormat !== 'YYYY-MM-DD' &&
              dateFormat !== 'DD/MM/YYYY' &&
              dateFormat !== 'MM/DD/YYYY')
          )
            throw invalidResponse(200);
          try {
            new Intl.DateTimeFormat('en', { timeZone });
          } catch {
            throw invalidResponse(200);
          }
          return { timeZone, dateFormat };
        },
        options(signal, queryKeys.datePreferences(identity)),
      ),
    timeZone: (signal: AbortSignal) =>
      api.json(
        '/users/me/preferences',
        (value) => {
          const zone = name(row(value).timeZone);
          if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(zone))
            throw invalidResponse(200);
          new Intl.DateTimeFormat('en', { timeZone: zone });
          return zone;
        },
        options(signal, [...queryKeys.me(identity), 'time-zone']),
      ),
  };
}
