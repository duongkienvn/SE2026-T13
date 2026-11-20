import {
  ApiError,
  invalidResponse,
} from '../../../infrastructure/api/errors.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import { isUuid } from '../../../infrastructure/auth/credential-record.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import { requirePage } from '../../../infrastructure/query/pagination.ts';
import { contentError, validSpans, type Mention } from './mentions.ts';

export type Comment = {
  id: string;
  cardId: string;
  authorId: string;
  author?: { displayName: 'Deleted user'; isDeleted: true };
  content: string;
  mentions: Mention[];
  createdAt: string;
  updatedAt: string;
};
export type CommentInput = { content: string; mentions: Mention[] };
export const COMMENTS_LIMIT = 20;
function id(value: unknown, status: number) {
  if (!isUuid(value))
    throw new ApiError(status === 400 ? 'http' : 'invalid-response', {
      status,
    });
  return value.toLowerCase();
}
function record(value: unknown, status: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse(status);
  return value as Record<string, unknown>;
}
export function decodeComment(
  raw: unknown,
  cardId: string,
  status = 200,
): Comment {
  const dto = record(raw, status);
  if (
    id(dto.cardId, status) !== cardId ||
    typeof dto.content !== 'string' ||
    contentError(dto.content) ||
    !validSpans(dto.content, dto.mentions) ||
    typeof dto.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(dto.createdAt)) ||
    typeof dto.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(dto.updatedAt)) ||
    Date.parse(dto.updatedAt) < Date.parse(dto.createdAt)
  )
    throw invalidResponse(status);
  let author: Comment['author'];
  if (dto.author !== undefined && dto.author !== null) {
    const value = record(dto.author, status);
    if (value.displayName !== 'Deleted user' || value.isDeleted !== true)
      throw invalidResponse(status);
    author = { displayName: 'Deleted user', isDeleted: true };
  }
  return {
    id: id(dto.id, status),
    cardId,
    authorId: id(dto.authorId, status),
    ...(author ? { author } : {}),
    content: dto.content,
    mentions: dto.mentions.map(({ userId, start, end }) => ({
      userId: userId.toLowerCase(),
      start,
      end,
    })),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}
export function compareComments(a: Comment, b: Comment) {
  return (
    Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
export function createCommentsApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
  cardId: string,
) {
  const board = id(boardId, 400),
    card = id(cardId, 400);
  const key = queryKeys.comments(identity, board, card);
  const base = `/boards/${board}/cards/${card}/comments`;
  const options = (signal: AbortSignal) => ({
    identity,
    resourceKey: key,
    signal,
    retries: 0 as const,
  });
  const writeOptions = (signal: AbortSignal) => ({
    ...options(signal),
    resourceKey: [...key, 'write'] as const,
  });
  function send(
    method: 'POST' | 'PATCH',
    input: CommentInput,
    signal: AbortSignal,
    commentId?: string,
  ) {
    if (
      input.content !== input.content.trim() ||
      contentError(input.content) ||
      !validSpans(input.content, input.mentions)
    )
      throw new ApiError('http', { status: 400 });
    const status = method === 'POST' ? 201 : 200;
    return api.json(
      commentId ? `${base}/${id(commentId, 400)}` : base,
      (raw) => {
        const value = decodeComment(raw, card, status);
        if (
          value.authorId !== identity.userId ||
          (commentId && value.id !== commentId) ||
          value.content !== input.content ||
          JSON.stringify(value.mentions) !== JSON.stringify(input.mentions)
        )
          throw invalidResponse(status);
        return value;
      },
      { ...writeOptions(signal), method, body: input, expectedStatus: status },
    );
  }
  return {
    async list(page: number, signal: AbortSignal, limit = COMMENTS_LIMIT) {
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isSafeInteger((page - 1) * limit)
      )
        throw new ApiError('http', { status: 400 });
      const result = requirePage(
        await api.envelope(
          base,
          (raw) => {
            if (!Array.isArray(raw) || raw.length > limit)
              throw invalidResponse(200);
            const rows = raw.map((value: unknown) =>
              decodeComment(value, card),
            );
            if (
              new Set(rows.map((row) => row.id)).size !== rows.length ||
              rows.some(
                (row, i) => i > 0 && compareComments(rows[i - 1], row) > 0,
              )
            )
              throw invalidResponse(200);
            return rows;
          },
          { ...options(signal), query: { page, limit }, expectedStatus: 200 },
        ),
      );
      if (
        result.meta.page !== page ||
        result.meta.limit !== limit ||
        result.meta.totalPages !== Math.ceil(result.meta.total / limit) ||
        result.data.length > result.meta.total
      )
        throw invalidResponse(200);
      return result;
    },
    create: (input: CommentInput, signal: AbortSignal) =>
      send('POST', input, signal),
    edit: (commentId: string, input: CommentInput, signal: AbortSignal) =>
      send('PATCH', input, signal, commentId),
    remove: (commentId: string, signal: AbortSignal) =>
      api.empty(`${base}/${id(commentId, 400)}`, {
        ...writeOptions(signal),
        method: 'DELETE',
        expectedStatus: 204,
      }),
  };
}
