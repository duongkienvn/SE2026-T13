import { makeBoard } from './board-fixtures';
import type {
  WorkspaceResponse,
  WorkspaceBoardResponse,
  WorkspaceOverviewResponse,
} from '../features/workspaces/response';
import type { MockResponse } from './mock-api';

export const workspaceResponse: WorkspaceResponse = {
  id: '00000000-0000-4000-8000-000000000113',
  type: 'TEAM',
  name: 'Engineering',
  description: null,
  icon: null,
  role: 'MEMBER',
  canManage: false,
  canCreateBoards: true,
  joinedAt: '2026-10-28T00:00:00.000Z',
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
};
export const workspaceBoardResponse: WorkspaceBoardResponse = {
  ...makeBoard({ name: 'Sprint', id: '00000000-0000-4000-8000-000000000114' }),
  workspaceId: workspaceResponse.id,
  visibility: 'PRIVATE',
  canEdit: true,
};
export const workspaceOverviewResponse: WorkspaceOverviewResponse = {
  workspace: workspaceResponse,
  visibleBoardCount: 21,
  activeBoardCount: 20,
  archivedBoardCount: 1,
  memberCount: null,
  recentBoards: [workspaceBoardResponse],
};
export function workspacePage<T>(
  items: T[],
  page = 1,
  total = items.length,
  limit = 20,
): MockResponse {
  return {
    status: 200,
    body: {
      success: true,
      statusCode: 200,
      message: 'OK',
      data: items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  };
}
