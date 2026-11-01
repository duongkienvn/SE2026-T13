/*
 * Frontend copies of the Card Management contract (issue #34,
 * `CardResponseDto`). Replace with `@kanban/shared` exports if the backend
 * publishes them.
 */

/** Only ids: names and avatars come from the board's member list. */
export interface CardAssignee {
  userId: string;
  assignedById: string | null;
  createdAt: string;
}

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  createdById: string;
  title: string;
  description: string | null;
  /** Decimal string; compare with `compareByPosition`, never `parseFloat`. */
  position: string;
  /** UTC instant (P3-03), or `null` for no start date. */
  startDate: string | null;
  /** UTC instant, or `null` for no due date. */
  dueDate: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignees: CardAssignee[];
}

export interface CreateCardRequest {
  columnId: string;
  title: string;
  description?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
}

/**
 * Omitted fields stay as they are; `null` clears. Never send it empty. Dates
 * are ISO instants with `Z` or an offset, never bare calendar days.
 */
export interface UpdateCardRequest {
  title?: string;
  description?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
}

/** Same-board copy; an omitted column keeps the source card's column. */
export interface DuplicateCardRequest {
  columnId?: string;
}

export interface MoveCardRequest {
  /** Required even when the card stays in its column. */
  toColumnId: string;
  /** Place the card before this active card; `null` moves it to the end. */
  beforeCardId: string | null;
}

export interface AssignCardRequest {
  userId: string;
}
