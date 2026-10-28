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
  };
}

export function mapWorkspaceBoard(
  item: WorkspaceBoardResponse,
): WorkspaceBoardSummary {
  // #115 must deliver read-only grants before these can be presented or opened.
  if (
    item.visibility !== 'PRIVATE' ||
    !['OWNER', 'MEMBER'].includes(item.currentUserRole)
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
