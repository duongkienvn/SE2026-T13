import {
  TaskGroup,
  type HomeBoardSummary,
  type TaskCardSummary,
} from '@kanban/shared';
import { destinationPath, parseResourceId } from '../../navigation/routes.ts';
import {
  formatWallTime,
  wallTime,
  type DatePreferences,
} from '../cards/metadata/dates.ts';
import { accountDay, accountHour } from '../preferences/temporal.ts';

export const tasksPath = destinationPath({ kind: 'tab', tab: 'tasks' });
export const boardsPath = destinationPath({ kind: 'tab', tab: 'boards' });

export function cardPath(task: Pick<TaskCardSummary, 'id' | 'boardId'>) {
  const cardId = parseResourceId(task.id);
  const boardId = parseResourceId(task.boardId);
  return cardId && boardId
    ? destinationPath({ kind: 'card', cardId, boardId })
    : null;
}

export function boardPath(board: Pick<HomeBoardSummary, 'id'>) {
  const boardId = parseResourceId(board.id);
  return boardId ? destinationPath({ kind: 'board', boardId }) : null;
}

export function greeting(
  displayName: string,
  now: Date,
  preferences: DatePreferences | undefined,
) {
  const firstName = displayName.trim().split(/\s+/, 1)[0];
  // Match Web: no period is claimed until the saved account timezone is known.
  if (!preferences) return firstName ? `Welcome, ${firstName}` : 'Welcome';
  const hour = accountHour(now.getTime(), preferences.timeZone);
  const period =
    hour < 5
      ? 'evening'
      : hour < 12
        ? 'morning'
        : hour < 18
          ? 'afternoon'
          : 'evening';
  return firstName ? `Good ${period}, ${firstName}` : `Good ${period}`;
}

/** Absolute day in the saved timezone and date format (UTC/ISO when unknown). */
export function formatHomeDate(date: Date, preferences: DatePreferences) {
  return formatWallTime(
    wallTime(date.getTime(), preferences.timeZone),
    preferences.dateFormat,
  ).date;
}

function nextCivilDay(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function dueLabel(
  task: Pick<TaskCardSummary, 'dueDate' | 'group'>,
  now: Date,
  preferences: DatePreferences,
) {
  if (task.dueDate === null) return 'No due date';
  const date = new Date(task.dueDate);
  const formatted = formatHomeDate(date, preferences);
  if (task.group === TaskGroup.OVERDUE) return `Overdue · ${formatted}`;
  // The backend uses the saved timezone for group membership. Only use
  // relative labels for its upcoming group, on the same account calendar.
  if (task.group === TaskGroup.NEXT_7_DAYS) {
    const today = accountDay(now.getTime(), preferences.timeZone);
    const due = accountDay(date.getTime(), preferences.timeZone);
    if (due === today) return 'Today';
    if (due === nextCivilDay(today)) return 'Tomorrow';
    return `Next 7 days · ${formatted}`;
  }
  return `Later · ${formatted}`;
}
