import { WorkspaceRole, WorkspaceType } from '@kanban/shared';
import {
  decodeWorkspace,
  type WorkspaceSummary,
} from '../../src/features/workspaces/decoder.ts';

export function uuid(n: number) {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}
const date = '2026-11-13T09:00:00.000Z';
export function workspace(
  n = 1,
  type: WorkspaceSummary['type'] = WorkspaceType.TEAM,
) {
  return decodeWorkspace({
    id: uuid(n),
    type,
    name: n === 1 ? 'Product team' : `Workspace ${n}`,
    description: null,
    icon: null,
    role: WorkspaceRole.MEMBER,
    canManage: false,
    canCreateBoards: false,
    joinedAt: date,
    createdAt: date,
    updatedAt: date,
  });
}
export function board(workspaceId = uuid(1), n = 1) {
  return {
    id: uuid(n + 1000),
    workspaceId,
    name: `Board ${n}`,
    description: null,
    isArchived: false,
    archivedAt: null,
    createdAt: date,
    updatedAt: date,
    visibility: 'WORKSPACE_VISIBLE',
    currentUserRole: null,
    backgroundPreset: 'forest',
    backgroundVersion: 1,
    canEdit: false,
    memberCount: null,
    isStarred: false,
    lastViewedAt: null,
    capabilities: {
      canReadBoard: true,
      canWriteBoard: false,
      canManageBoard: false,
      canManageMembers: false,
      canRestoreBoard: false,
    },
  };
}
export function overview(row = workspace()) {
  return {
    workspace: row,
    memberCount: 3,
    visibleBoardCount: 1,
    activeBoardCount: 1,
    archivedBoardCount: 0,
    recentBoards: [board(row.id)],
  };
}
export function page<T>(rows: T[], number: number, limit: number) {
  return {
    success: true,
    statusCode: 200,
    message: 'OK',
    data: rows.slice((number - 1) * limit, number * limit),
    meta: {
      page: number,
      limit,
      total: rows.length,
      totalPages: Math.ceil(rows.length / limit),
    },
  };
}
