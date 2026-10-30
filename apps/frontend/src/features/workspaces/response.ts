import type { BoardVisibility } from '@kanban/shared';
import { ApiError, ClientErrorCode } from '../../lib/api-client';
import type { Board } from '../boards/types';
import type { WorkspaceSummary } from './types';
import type { WorkspaceBoardSummary } from './boards/types';

/** Wire DTOs from docs/tasks/backend/workspace-core-api.md. */
export interface WorkspaceResponse extends WorkspaceSummary {
  icon: 'briefcase' | 'users' | 'code' | 'palette' | 'layers' | null;
  canManage: boolean;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceBoardResponse extends Board {
  workspaceId: string;
  visibility: BoardVisibility;
  canEdit: boolean;
}

export interface WorkspaceOverviewResponse {
  workspace: WorkspaceResponse;
  visibleBoardCount: number;
  activeBoardCount: number;
  archivedBoardCount: number;
  memberCount: number | null;
  recentBoards: WorkspaceBoardResponse[];
}

export function mapWorkspace(item: WorkspaceResponse): WorkspaceSummary {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    type: item.type,
    role: item.role,
    canCreateBoards: item.canCreateBoards,
    icon: item.icon,
  };
}

export function mapWorkspaceBoard(
  item: WorkspaceBoardResponse,
): WorkspaceBoardSummary {
  if (
    !['PRIVATE', 'WORKSPACE_VISIBLE'].includes(item.visibility) ||
    ![null, 'OWNER', 'MEMBER'].includes(item.currentUserRole) ||
    (item.currentUserRole === null && item.visibility !== 'WORKSPACE_VISIBLE')
  ) {
    throw new ApiError(
      200,
      ClientErrorCode.INVALID_RESPONSE,
      'Unsupported board access.',
    );
  }
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    updatedAt: item.updatedAt,
    isArchived: item.isArchived,
    visibility: item.visibility,
    currentUserRole: item.currentUserRole,
    // Archive/restore are OWNER actions; canEdit describes collaboration only.
    canArchive: item.currentUserRole === 'OWNER' && !item.isArchived,
    canRestore: item.currentUserRole === 'OWNER' && item.isArchived,
    memberCount: null,
  };
}
