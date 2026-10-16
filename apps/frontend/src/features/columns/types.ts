/*
 * Frontend copies of the Column Management contract (issue #33,
 * `ColumnResponseDto`). Replace with `@kanban/shared` exports if the backend
 * publishes them.
 */

export interface Column {
  id: string;
  boardId: string;
  name: string;
  /** Decimal string; compare with `compareByPosition`, never `parseFloat`. */
  position: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateColumnRequest {
  name: string;
}

export interface RenameColumnRequest {
  name: string;
}

export interface MoveColumnRequest {
  /** Place the column before this one; `null` moves it to the end. */
  beforeColumnId: string | null;
}
