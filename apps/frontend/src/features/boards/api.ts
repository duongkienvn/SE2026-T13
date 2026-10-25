import {
  apiRequest,
  apiRequestPage,
  fetchAllPages,
  MAX_PAGE_LIMIT,
  type Page,
} from '../../lib/api-client';
import type { Board, CreateBoardRequest, UpdateBoardRequest } from './types';

export function listBoards(
  accessToken: string,
  page: number,
  signal?: AbortSignal,
  status: 'active' | 'archived' = 'active',
): Promise<Page<Board>> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(MAX_PAGE_LIMIT),
  });
  if (status === 'archived') query.set('status', status);
  return apiRequestPage<Board>(`/boards?${query}`, { accessToken, signal });
}

/**
 * Every board the user belongs to. #20 has no server-side search, so the list
 * page loads all boards to search and paginate them on screen.
 */
export function listAllBoards(
  accessToken: string,
  signal?: AbortSignal,
  status: 'active' | 'archived' = 'active',
): Promise<Board[]> {
  return fetchAllPages((page) => listBoards(accessToken, page, signal, status));
}

export function getBoard(
  accessToken: string,
  boardId: string,
  signal?: AbortSignal,
): Promise<Board> {
  return apiRequest<Board>(`/boards/${encodeURIComponent(boardId)}`, {
    accessToken,
    signal,
  });
}

export function createBoard(
  accessToken: string,
  input: CreateBoardRequest,
): Promise<Board> {
  return apiRequest<Board>('/boards', {
    method: 'POST',
    body: input,
    accessToken,
  });
}

export function updateBoard(
  accessToken: string,
  boardId: string,
  input: UpdateBoardRequest,
): Promise<Board> {
  return apiRequest<Board>(`/boards/${encodeURIComponent(boardId)}`, {
    method: 'PATCH',
    body: input,
    accessToken,
  });
}

export function archiveBoard(
  accessToken: string,
  boardId: string,
): Promise<Board> {
  return apiRequest<Board>(`/boards/${encodeURIComponent(boardId)}/archive`, {
    method: 'POST',
    accessToken,
  });
}

export function restoreBoard(
  accessToken: string,
  boardId: string,
): Promise<Board> {
  return apiRequest<Board>(`/boards/${encodeURIComponent(boardId)}/restore`, {
    method: 'POST',
    accessToken,
  });
}
