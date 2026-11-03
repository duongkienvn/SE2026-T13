import type {
  ApiPaginatedResponse,
  ApiSuccessResponse,
} from './api-response.js';
import type { BoardBackgroundPresetId } from './board-discovery.js';

export const TaskGroup = {
  OVERDUE: 'OVERDUE',
  NEXT_7_DAYS: 'NEXT_7_DAYS',
  LATER: 'LATER',
  NO_DUE_DATE: 'NO_DUE_DATE',
} as const;
export type TaskGroup = (typeof TaskGroup)[keyof typeof TaskGroup];
export type TaskGroupCounts = Record<TaskGroup, number>;
export type TaskSort = 'dueDate' | 'updatedAt' | 'board';

export interface MyTasksFilters {
  page?: number;
  limit?: number;
  group?: 'ALL' | TaskGroup;
  workspaceId?: string;
  boardId?: string;
  /** Comma-separated distinct UUIDs; matches any label. */
  labelIds?: string;
  dueFrom?: string;
  dueTo?: string;
  sort?: TaskSort;
}

export interface TaskCardSummary {
  id: string;
  boardId: string;
  workspaceId: string;
  title: string;
  boardName: string;
  workspaceName: string;
  columnId: string;
  startDate: string | null;
  dueDate: string | null;
  updatedAt: string;
  group: TaskGroup;
  permalink: string;
  labels: { id: string; name: string; color: string }[];
}

export interface HomeBoardSummary {
  id: string;
  workspaceId: string;
  name: string;
  backgroundPreset: BoardBackgroundPresetId;
  isStarred: boolean;
  lastViewedAt: string | null;
  path: string;
}

export interface HomeDashboard {
  summary: {
    assignedActiveCount: number;
    overdueCount: number;
    dueNext7DaysCount: number;
    workspaceCount: number;
  };
  upNext: TaskCardSummary[];
  starredBoards: HomeBoardSummary[];
  recentBoards: HomeBoardSummary[];
}

export type MyTasksResponse = ApiPaginatedResponse<TaskCardSummary> & {
  groupCounts: TaskGroupCounts;
};
export type HomeResponse = ApiSuccessResponse<HomeDashboard>;
