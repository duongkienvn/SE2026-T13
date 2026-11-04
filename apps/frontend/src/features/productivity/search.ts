import type { TaskGroup, TaskSort } from '@kanban/shared';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const groups = [
  'ALL',
  'OVERDUE',
  'NEXT_7_DAYS',
  'LATER',
  'NO_DUE_DATE',
] as const;
const sorts = ['dueDate', 'updatedAt', 'board'] as const;

export interface TaskSearch {
  group: 'ALL' | TaskGroup;
  sort: TaskSort;
  page: number;
  workspaceId?: string;
  boardId?: string;
  labelIds?: string;
  dueFrom?: string;
  dueTo?: string;
}

function calendarDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  if (value < '0001-01-01' || value > '9998-12-31') return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

export function parseTaskSearch(params: URLSearchParams): TaskSearch {
  const one = (key: string) =>
    params.getAll(key).length === 1 ? params.get(key) : null;
  const group = one('group');
  const sort = one('sort');
  const rawPage = one('page');
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  const workspaceId = one('workspaceId');
  const boardId = one('boardId');
  const labels = one('labelIds')?.toLowerCase().split(',');
  const validLabels =
    labels &&
    labels.length <= 50 &&
    labels.every((id) => uuid.test(id)) &&
    new Set(labels).size === labels.length;
  const dueFrom = calendarDate(one('dueFrom'));
  const dueTo = calendarDate(one('dueTo'));
  return {
    group: groups.includes(group as (typeof groups)[number])
      ? (group as TaskSearch['group'])
      : 'ALL',
    sort: sorts.includes(sort as TaskSort) ? (sort as TaskSort) : 'dueDate',
    page:
      Number.isSafeInteger(page) && Number.isSafeInteger((page - 1) * 20)
        ? page
        : 1,
    workspaceId:
      workspaceId && uuid.test(workspaceId)
        ? workspaceId.toLowerCase()
        : undefined,
    boardId: boardId && uuid.test(boardId) ? boardId.toLowerCase() : undefined,
    labelIds:
      boardId && uuid.test(boardId) && validLabels
        ? labels?.join(',')
        : undefined,
    dueFrom,
    dueTo: dueFrom && dueTo && dueTo < dueFrom ? undefined : dueTo,
  };
}

/** Canonicalize known fields while preserving unrelated route context. */
export function normalizeTaskSearch(params: URLSearchParams): URLSearchParams {
  const parsed = parseTaskSearch(params);
  const next = new URLSearchParams(params);
  const values: Record<string, string | undefined> = {
    group: parsed.group === 'ALL' ? undefined : parsed.group,
    sort: parsed.sort === 'dueDate' ? undefined : parsed.sort,
    page: parsed.page === 1 ? undefined : String(parsed.page),
    workspaceId: parsed.workspaceId,
    boardId: parsed.boardId,
    labelIds: parsed.labelIds,
    dueFrom: parsed.dueFrom,
    dueTo: parsed.dueTo,
  };
  for (const [key, value] of Object.entries(values)) {
    next.delete(key);
    if (value) next.set(key, value);
  }
  return next;
}
