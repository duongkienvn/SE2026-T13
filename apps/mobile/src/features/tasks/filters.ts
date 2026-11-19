import type { TaskFilters } from './api.ts';

export type TaskSelection = {
  workspaceId?: string;
  boardId?: string;
  labelIds: string[];
  dueFrom: string;
  dueThrough: string;
  sort: 'dueDate' | 'updatedAt' | 'board';
};
export const emptyTaskSelection: TaskSelection = {
  labelIds: [],
  dueFrom: '',
  dueThrough: '',
  sort: 'dueDate',
};

export function calendarDay(value: string) {
  const ms = Date.parse(value + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 10) !== value
  )
    throw new RangeError('Choose a valid calendar date.');
  return ms;
}
export function nextDay(value: string) {
  const date = new Date(calendarDay(value));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Find the first instant on a local day, including skipped/repeated midnight. */
export function localDayStart(value: string, timeZone: string) {
  const midnight = calendarDay(value);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  });
  const localDate = (at: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(at).map(({ type, value }) => [type, value]),
    );
    return parts.era === 'BC'
      ? '0000-00-00'
      : `${parts.year?.padStart(4, '0')}-${parts.month}-${parts.day}`;
  };
  const step = 15 * 60_000;
  let previous = midnight - 3 * 86_400_000;
  for (let at = previous + step; at <= midnight + 3 * 86_400_000; at += step) {
    if (localDate(at) >= value) {
      let low = previous;
      let high = at;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (localDate(middle) >= value) high = middle;
        else low = middle;
      }
      return new Date(high).toISOString();
    }
    previous = at;
  }
  throw new RangeError('Choose a date within the supported range.');
}
export function taskDateFilters(
  selection: TaskSelection,
  timeZone: string,
): TaskFilters {
  if (
    selection.dueFrom &&
    selection.dueThrough &&
    selection.dueFrom > selection.dueThrough
  )
    throw new RangeError('Due from must be on or before due through.');
  const dueFrom = selection.dueFrom
    ? localDayStart(selection.dueFrom, timeZone)
    : undefined;
  const dueTo = selection.dueThrough
    ? localDayStart(nextDay(selection.dueThrough), timeZone)
    : undefined;
  if (dueFrom && dueTo && dueFrom >= dueTo)
    throw new RangeError('Choose a date range that exists in this time zone.');
  return {
    workspaceId: selection.workspaceId,
    boardId: selection.boardId,
    labelIds: selection.labelIds,
    sort: selection.sort,
    dueFrom,
    dueTo,
  };
}

export function selectWorkspace(
  selection: TaskSelection,
  workspaceId?: string,
): TaskSelection {
  return { ...selection, workspaceId, boardId: undefined, labelIds: [] };
}
export function selectBoard(
  selection: TaskSelection,
  boardId?: string,
): TaskSelection {
  return { ...selection, boardId, labelIds: [] };
}
