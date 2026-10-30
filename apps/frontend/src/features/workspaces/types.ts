import type { WorkspaceRole, WorkspaceType } from '@kanban/shared';

/** Presentation models mapped from the Workspace API DTOs. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  type: WorkspaceType;
  role: WorkspaceRole;
  canCreateBoards: boolean;
  /** Optional approved icon; the initial letter is shown without one. */
  icon?: 'briefcase' | 'users' | 'code' | 'palette' | 'layers' | null;
}

export interface RecentWorkspaceBoard {
  id: string;
  name: string;
  updatedAt: string;
  archived: boolean;
  memberCount: number | null;
}

export interface WorkspaceOverview {
  workspace: WorkspaceSummary;
  /** Server ACL-filtered totals only. null means unsupported, never zero. */
  visibleBoardCount: number | null;
  memberCount: number | null;
  recentBoards: RecentWorkspaceBoard[];
}

export interface CreateTeamWorkspaceInput {
  name: string;
  description: string;
}

export type WorkspaceViewState =
  'loading' | 'ready' | 'unavailable' | 'forbidden' | 'not-found' | 'error';
