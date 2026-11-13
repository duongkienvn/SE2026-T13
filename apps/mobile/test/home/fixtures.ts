import { TaskGroup, type HomeDashboard } from '@kanban/shared';
import { USER_A, USER_B } from '../auth/support.ts';

export const boardId = USER_A;
export const cardId = USER_B;
export const workspaceId = '33333333-3333-4333-8333-333333333333';
export const date = '2026-11-13T09:00:00.000Z';

export function fixture(): HomeDashboard {
  const board = {
    id: boardId,
    workspaceId,
    name: 'Release planning',
    backgroundPreset: 'forest',
    isStarred: true,
    lastViewedAt: date,
    path: `/boards/${boardId}`,
  } as const;
  return {
    summary: {
      assignedActiveCount: 18,
      overdueCount: 2,
      dueNext7DaysCount: 4,
      workspaceCount: 1,
    },
    upNext: [
      {
        id: cardId,
        boardId,
        workspaceId,
        columnId: workspaceId,
        title: 'Review release notes',
        boardName: board.name,
        workspaceName: 'Engineering',
        updatedAt: date,
        dueDate: date,
        startDate: null,
        group: TaskGroup.NEXT_7_DAYS,
        labels: [{ id: workspaceId, name: 'Documentation', color: '#2563EB' }],
        permalink: `/boards/${boardId}/cards/${cardId}`,
      },
    ],
    starredBoards: [board],
    recentBoards: [board],
  };
}

export function emptyHome(): HomeDashboard {
  return {
    summary: {
      assignedActiveCount: 0,
      overdueCount: 0,
      dueNext7DaysCount: 0,
      workspaceCount: 0,
    },
    upNext: [],
    starredBoards: [],
    recentBoards: [],
  };
}
