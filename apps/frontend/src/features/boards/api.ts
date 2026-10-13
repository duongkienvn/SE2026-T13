import { apiRequest, apiRequestPage, type Page } from '../../lib/api-client';
import type { Board, CreateBoardRequest, UpdateBoardRequest } from './types';

export const BOARDS_PAGE_SIZE = 24;

export function listBoards(
  accessToken: string,
  page: number,
  signal?: AbortSignal,
): Promise<Page<Board>> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(BOARDS_PAGE_SIZE),
  });
  return apiRequestPage<Board>(`/boards?${query}`, { accessToken, signal });
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
