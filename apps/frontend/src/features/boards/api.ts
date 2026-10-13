import { apiRequest, apiRequestPage, type Page } from '../../lib/api-client';
import type { Board, CreateBoardRequest, UpdateBoardRequest } from './types';

/** The backend's maximum page size (`PageQueryDto`). */
export const BOARDS_FETCH_LIMIT = 100;

export function listBoards(
  accessToken: string,
  page: number,
  signal?: AbortSignal,
): Promise<Page<Board>> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(BOARDS_FETCH_LIMIT),
  });
  return apiRequestPage<Board>(`/boards?${query}`, { accessToken, signal });
}

/**
 * Every board the user belongs to. #20 has no server-side search, so the list
 * page loads all boards to search and paginate them on screen.
 */
export async function listAllBoards(
  accessToken: string,
  signal?: AbortSignal,
): Promise<Board[]> {
  const first = await listBoards(accessToken, 1, signal);
  const boards = [...first.items];
  for (let page = 2; page <= first.meta.totalPages; page += 1) {
    boards.push(...(await listBoards(accessToken, page, signal)).items);
  }
  return boards;
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
