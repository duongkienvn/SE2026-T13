import {
  TaskGroup,
  type HomeBoardSummary,
  type HomeDashboard,
  type TaskCardSummary,
} from '@kanban/shared';
import { isUuid } from '../../infrastructure/auth/credential-record.ts';
import {
  destinationPath,
  parseResourceId,
  type ResourceId,
} from '../../navigation/routes.ts';
import { isBoardPreset } from './presets.ts';

function invalid(): never {
  throw new Error('Invalid Home dashboard');
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalid();
}

function id(value: unknown): ResourceId {
  const resourceId =
    isUuid(value) && value.length === 36 ? parseResourceId(value) : null;
  return resourceId ?? invalid();
}

function name(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : invalid();
}

function instant(value: unknown): string {
  // The service serializes PostgreSQL Dates with toISOString().
  if (typeof value !== 'string') return invalid();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : invalid();
}

function nullableInstant(value: unknown) {
  return value === null ? null : instant(value);
}

function list<T extends { id: string }>(
  value: unknown,
  limit: number,
  decode: (entry: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > limit) return invalid();
  const items = Array.from(value, decode);
  return new Set(items.map((item) => item.id)).size === items.length
    ? items
    : invalid();
}

function decodeLabel(value: unknown): TaskCardSummary['labels'][number] {
  const row = record(value);
  if (
    typeof row.color !== 'string' ||
    row.color.length !== 7 ||
    !/^#[a-f0-9]{6}$/i.test(row.color)
  )
    return invalid();
  return { id: id(row.id), name: name(row.name), color: row.color };
}

function decodeTask(value: unknown): TaskCardSummary {
  const row = record(value);
  const cardId = id(row.id);
  const boardId = id(row.boardId);
  const permalink = destinationPath({ kind: 'card', boardId, cardId });
  const dueDate = nullableInstant(row.dueDate);
  const group = Object.values(TaskGroup).find(
    (candidate) => candidate === row.group,
  );
  if (
    row.permalink !== permalink ||
    !group ||
    (group === TaskGroup.NO_DUE_DATE) !== (dueDate === null)
  )
    return invalid();
  return {
    id: cardId,
    boardId,
    workspaceId: id(row.workspaceId),
    columnId: id(row.columnId),
    title: name(row.title),
    boardName: name(row.boardName),
    workspaceName: name(row.workspaceName),
    startDate: nullableInstant(row.startDate),
    dueDate,
    updatedAt: instant(row.updatedAt),
    group,
    permalink,
    labels: list(row.labels, 200, decodeLabel),
  };
}

function decodeBoard(value: unknown): HomeBoardSummary {
  const row = record(value);
  const boardId = id(row.id);
  const path = destinationPath({ kind: 'board', boardId });
  if (
    row.path !== path ||
    !isBoardPreset(row.backgroundPreset) ||
    typeof row.isStarred !== 'boolean'
  )
    return invalid();
  return {
    id: boardId,
    workspaceId: id(row.workspaceId),
    name: name(row.name),
    backgroundPreset: row.backgroundPreset,
    isStarred: row.isStarred,
    lastViewedAt: nullableInstant(row.lastViewedAt),
    path,
  };
}

/** Project only the shared contract's fields. Transport converts rejection to a safe ApiError. */
export function decodeHomeDashboard(value: unknown): HomeDashboard {
  const home = record(value);
  const summary = record(home.summary);
  const starredBoards = list(home.starredBoards, 6, decodeBoard);
  const recentBoards = list(home.recentBoards, 6, decodeBoard);
  if (
    starredBoards.some((board) => !board.isStarred) ||
    recentBoards.some((board) => board.lastViewedAt === null)
  )
    return invalid();
  return {
    summary: {
      assignedActiveCount: count(summary.assignedActiveCount),
      overdueCount: count(summary.overdueCount),
      dueNext7DaysCount: count(summary.dueNext7DaysCount),
      workspaceCount: count(summary.workspaceCount),
    },
    upNext: list(home.upNext, 6, decodeTask),
    starredBoards,
    recentBoards,
  };
}
