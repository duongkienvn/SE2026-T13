import {
  apiRequest,
  apiRequestPage,
  fetchAllPages,
  MAX_PAGE_LIMIT,
  type Page,
} from '../../lib/api-client';
import type {
  Column,
  CreateColumnRequest,
  MoveColumnRequest,
  RenameColumnRequest,
} from './types';

function columnsPath(boardId: string, columnId?: string): string {
  const base = `/boards/${encodeURIComponent(boardId)}/columns`;
  return columnId ? `${base}/${encodeURIComponent(columnId)}` : base;
}

export function listColumns(
  accessToken: string,
  boardId: string,
  page: number,
  signal?: AbortSignal,
): Promise<Page<Column>> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(MAX_PAGE_LIMIT),
  });
  return apiRequestPage<Column>(`${columnsPath(boardId)}?${query}`, {
    accessToken,
    signal,
  });
}

/** Every column of the board, in the backend's `position, id` order. */
export function listAllColumns(
  accessToken: string,
  boardId: string,
  signal?: AbortSignal,
): Promise<Column[]> {
  return fetchAllPages((page) =>
    listColumns(accessToken, boardId, page, signal),
  );
}

export function createColumn(
  accessToken: string,
  boardId: string,
  input: CreateColumnRequest,
): Promise<Column> {
  return apiRequest<Column>(columnsPath(boardId), {
    method: 'POST',
    body: input,
    accessToken,
  });
}

export function renameColumn(
  accessToken: string,
  boardId: string,
  columnId: string,
  input: RenameColumnRequest,
): Promise<Column> {
  return apiRequest<Column>(columnsPath(boardId, columnId), {
    method: 'PATCH',
    body: input,
    accessToken,
  });
}

export function moveColumn(
  accessToken: string,
  boardId: string,
  columnId: string,
  input: MoveColumnRequest,
): Promise<Column> {
  return apiRequest<Column>(`${columnsPath(boardId, columnId)}/move`, {
    method: 'PATCH',
    body: input,
    accessToken,
  });
}

/** 409 `COLUMN_NOT_EMPTY` while any card (archived ones too) is in it. */
export function deleteColumn(
  accessToken: string,
  boardId: string,
  columnId: string,
): Promise<void> {
  return apiRequest<void>(columnsPath(boardId, columnId), {
    method: 'DELETE',
    accessToken,
  });
}
