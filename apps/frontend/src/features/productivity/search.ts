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
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

export function parseTaskSearch(params: URLSearchParams): TaskSearch {
  const group = params.get('group');
  const sort = params.get('sort');
  const rawPage = params.get('page');
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  const workspaceId = params.get('workspaceId');
  const boardId = params.get('boardId');
  const labels = params.get('labelIds')?.toLowerCase().split(',');
  const validLabels =
    labels &&
    labels.length <= 50 &&
    labels.every((id) => uuid.test(id)) &&
    new Set(labels).size === labels.length;
  const dueFrom = calendarDate(params.get('dueFrom'));
  const dueTo = calendarDate(params.get('dueTo'));
  return {
    group: groups.includes(group as (typeof groups)[number])
      ? (group as TaskSearch['group'])
      : 'ALL',
    sort: sorts.includes(sort as TaskSort) ? (sort as TaskSort) : 'dueDate',
    page: Number.isSafeInteger(page) ? page : 1,
    workspaceId:
      workspaceId && uuid.test(workspaceId) ? workspaceId : undefined,
    boardId: boardId && uuid.test(boardId) ? boardId : undefined,
    labelIds:
      boardId && uuid.test(boardId) && validLabels
        ? labels?.join(',')
        : undefined,
    dueFrom,
    dueTo: dueFrom && dueTo && dueTo < dueFrom ? undefined : dueTo,
  };
}
