import type {
  HomeBoardSummary,
  HomeDashboard,
  TaskCardSummary,
} from '@kanban/shared';
import { ApiError, ClientErrorCode, apiRequest } from '../../../lib/api-client';

const isCount = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Internal app routes only; never follow an absolute or protocol-relative URL. */
export function isInternalPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
  );
}

function isTask(value: unknown): value is TaskCardSummary {
  const task = value as TaskCardSummary | null;
  return (
    !!task &&
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.boardName === 'string' &&
    typeof task.workspaceName === 'string' &&
    typeof task.group === 'string' &&
    (task.dueDate === null || typeof task.dueDate === 'string') &&
    isInternalPath(task.permalink) &&
    Array.isArray(task.labels)
  );
}

function isBoard(value: unknown): value is HomeBoardSummary {
  const board = value as HomeBoardSummary | null;
  return (
    !!board &&
    typeof board.id === 'string' &&
    typeof board.name === 'string' &&
    typeof board.isStarred === 'boolean' &&
    (board.lastViewedAt === null || typeof board.lastViewedAt === 'string') &&
    isInternalPath(board.path)
  );
}

/** Reject a malformed aggregate instead of rendering phantom counts or links. */
export function parseHomeDashboard(value: unknown): HomeDashboard {
  const home = value as HomeDashboard | null;
  const summary = home?.summary;
  if (
    !home ||
    !summary ||
    !isCount(summary.assignedActiveCount) ||
    !isCount(summary.overdueCount) ||
    !isCount(summary.dueNext7DaysCount) ||
    !isCount(summary.workspaceCount) ||
    !Array.isArray(home.upNext) ||
    !home.upNext.every(isTask) ||
    !Array.isArray(home.starredBoards) ||
    !home.starredBoards.every(isBoard) ||
    !Array.isArray(home.recentBoards) ||
    !home.recentBoards.every(isBoard)
  )
    throw new ApiError(
      200,
      ClientErrorCode.INVALID_RESPONSE,
      'The server returned an unexpected response.',
    );
  return home;
}

/** `GET /api/users/me/home`; identity comes only from the session token. */
export async function readHomeDashboard(
  accessToken: string,
  signal: AbortSignal,
): Promise<HomeDashboard> {
  return parseHomeDashboard(
    await apiRequest<HomeDashboard>('/users/me/home', { accessToken, signal }),
  );
}
