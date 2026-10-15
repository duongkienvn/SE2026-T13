import type { BoardRole } from '@kanban/shared';

/*
 * Frontend copies of the Board Management contract (issue #20).
 * Replace with `@kanban/shared` exports if the backend publishes them.
 */

export interface Board {
  id: string;
  name: string;
  description: string | null;
  createdById: string;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The signed-in user's role on this board, resolved by the backend. */
  currentUserRole: BoardRole;
}

export interface CreateBoardRequest {
  name: string;
  description?: string | null;
}

export interface UpdateBoardRequest {
  name?: string;
  description?: string | null;
}
