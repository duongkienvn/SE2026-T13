import type { BoardRole, BoardVisibility } from '@kanban/shared';
import type { CreateBoardRequest } from '../../boards/types';

/** UI models mapped from the #111 wire DTOs. */
export interface WorkspaceBoardSummary {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string | null;
  isArchived: boolean;
  visibility: BoardVisibility;
  currentUserRole: BoardRole | null;
  canArchive: boolean;
  canRestore: boolean;
  /** Explicit Board roster count; null is withheld for privacy. */
  memberCount: number | null;
}

/** Safe Board fields only; no source Workspace membership or metadata needed. */
export type BoardOwnerActionModel = Pick<
  WorkspaceBoardSummary,
  'id' | 'name' | 'visibility' | 'currentUserRole' | 'isArchived'
> & { workspaceId: string; canManageBoard: boolean };

export function canUseBoardOwnerActions(board: BoardOwnerActionModel) {
  return (
    board.currentUserRole === 'OWNER' &&
    !board.isArchived &&
    board.canManageBoard
  );
}
export type WorkspaceBoardSort = 'updated-desc' | 'name-asc';
export interface WorkspaceBoardFilters {
  search: string;
  status: 'active' | 'archived';
  sort: WorkspaceBoardSort;
  page: number;
}
export interface WorkspaceBoardsPageData {
  items: WorkspaceBoardSummary[];
  /** ACL-filtered totals, never computed from a wider private collection. */
  total: number;
  page: number;
  pageCount: number;
}
export interface WorkspaceBoardsGateway {
  available: boolean;
  features: {
    search: boolean;
    status: boolean;
    sorts: readonly WorkspaceBoardSort[];
    pagination: boolean;
  };
  list(
    token: string,
    workspaceId: string,
    filters: WorkspaceBoardFilters,
    signal: AbortSignal,
  ): Promise<WorkspaceBoardsPageData>;
  create(
    token: string,
    workspaceId: string,
    input: CreateBoardRequest,
  ): Promise<{ id: string }>;
}
