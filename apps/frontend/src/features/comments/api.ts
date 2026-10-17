import { apiRequest, apiRequestPage, type Page } from '../../lib/api-client';
import type { Comment, CommentRequest } from './types';

export const COMMENTS_PAGE_LIMIT = 20;

function commentsPath(boardId: string, cardId: string, commentId?: string) {
  const base = `/boards/${encodeURIComponent(boardId)}/cards/${encodeURIComponent(cardId)}/comments`;
  return commentId ? `${base}/${encodeURIComponent(commentId)}` : base;
}

export function listComments(
  token: string,
  boardId: string,
  cardId: string,
  page: number,
  signal?: AbortSignal,
): Promise<Page<Comment>> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(COMMENTS_PAGE_LIMIT),
  });
  return apiRequestPage(`${commentsPath(boardId, cardId)}?${query}`, {
    accessToken: token,
    signal,
  });
}

export function createComment(
  token: string,
  boardId: string,
  cardId: string,
  input: CommentRequest,
): Promise<Comment> {
  return apiRequest(commentsPath(boardId, cardId), {
    method: 'POST',
    accessToken: token,
    body: { content: input.content.trim() },
  });
}

export function updateComment(
  token: string,
  boardId: string,
  cardId: string,
  commentId: string,
  input: CommentRequest,
): Promise<Comment> {
  return apiRequest(commentsPath(boardId, cardId, commentId), {
    method: 'PATCH',
    accessToken: token,
    body: { content: input.content.trim() },
  });
}

export function deleteComment(
  token: string,
  boardId: string,
  cardId: string,
  commentId: string,
): Promise<void> {
  return apiRequest(commentsPath(boardId, cardId, commentId), {
    method: 'DELETE',
    accessToken: token,
  });
}
