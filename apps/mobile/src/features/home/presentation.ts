import {
  TaskGroup,
  type HomeBoardSummary,
  type TaskCardSummary,
} from '@kanban/shared';
import { destinationPath, parseResourceId } from '../../navigation/routes.ts';

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

export function greeting(displayName: string, now: Date) {
  const hour = now.getHours();
  const period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const firstName = displayName.trim().split(/\s+/, 1)[0];
  return firstName ? `Good ${period}, ${firstName}` : `Good ${period}`;
}

function localDay(date: Date) {
  return [date.getFullYear(), date.getMonth(), date.getDate()].join('/');
}

const shortDate = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
} satisfies Intl.DateTimeFormatOptions;

export function formatHomeDate(date: Date) {
  // No fixed formatter timezone, so device timezone changes are reflected.
  return date.toLocaleDateString(undefined, shortDate);
}

export function dueLabel(
  task: Pick<TaskCardSummary, 'dueDate' | 'group'>,
  now: Date,
) {
  if (task.dueDate === null) return 'No due date';
  const date = new Date(task.dueDate);
  const formatted = formatHomeDate(date);
  if (task.group === TaskGroup.OVERDUE) return `Overdue · ${formatted}`;
  // The backend uses the saved timezone for group membership. Only use
  // relative calendar labels for its upcoming group, and only on local matches.
  if (task.group === TaskGroup.NEXT_7_DAYS) {
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    if (localDay(date) === localDay(now)) return 'Today';
    if (localDay(date) === localDay(tomorrow)) return 'Tomorrow';
    return `Next 7 days · ${formatted}`;
  }
  return `Later · ${formatted}`;
}
