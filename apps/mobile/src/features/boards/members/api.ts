import { BoardRole } from '@kanban/shared';
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

export const boardMembersPageSize = 20;

function record(value: unknown, status: number): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse(status);
  return value as Record<string, unknown>;
}
function id(value: unknown, status: number) {
  if (!isUuid(value)) throw invalidResponse(status);
  return value.toLowerCase();
}
function instant(value: unknown, status: number) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw invalidResponse(status);
  return value;
}

/** Full, authorized Board roster DTO. Never reuse the Workspace Guest projection. */
export function decodeBoardMember(value: unknown, status = 200) {
  const row = record(value, status);
  const user = record(row.user, status);
  if (
    !Object.values(BoardRole).includes(row.role as BoardRole) ||
    typeof user.displayName !== 'string' ||
    !user.displayName.trim() ||
    typeof user.email !== 'string' ||
    user.email.length > 320 ||
    (user.isDeleted !== undefined && typeof user.isDeleted !== 'boolean') ||
    (user.isDeleted === true
      ? user.email !== ''
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) ||
    (user.avatarUrl !== null && typeof user.avatarUrl !== 'string') ||
    typeof user.avatarRevision !== 'number' ||
    !Number.isSafeInteger(user.avatarRevision) ||
    user.avatarRevision < 0
  )
    throw invalidResponse(status);
  return {
    id: id(row.id, status),
    user: {
      id: id(user.id, status),
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl as string | null,
      avatarRevision: user.avatarRevision,
      createdAt: instant(user.createdAt, status),
      updatedAt: instant(user.updatedAt, status),
      ...(user.isDeleted !== undefined
        ? { isDeleted: user.isDeleted as boolean }
        : {}),
    },
    role: row.role as BoardRole,
    joinedAt: instant(row.joinedAt, status),
  };
}
export type BoardMember = ReturnType<typeof decodeBoardMember>;

export function boardMemberEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ApiError('http', {
      status: 400,
      message: 'Enter a valid email address, up to 320 characters.',
    });
  return email;
}

/** Page/limit are part of the key: the existing assignee catalog uses a smaller DTO. */
export function boardMembersKey(
  identity: SessionIdentity,
  boardId: string,
  page: number,
  limit = boardMembersPageSize,
) {
  return [
    ...queryKeys.members(identity, boardId),
    'directory',
    { page, limit },
  ] as const;
}

export function createBoardMembersApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
) {
  const board = id(boardId, 400);
  const path = `/boards/${encodeURIComponent(board)}/members`;
  const writeKey = [
    ...queryKeys.board(identity, board),
    'membership-write',
  ] as const;
  const options = (signal: AbortSignal) => ({
    identity,
    signal,
    resourceKey: writeKey,
    retries: 0 as const,
  });
  return {
    async list(
      page: number,
      signal: AbortSignal,
      limit = boardMembersPageSize,
    ) {
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isSafeInteger((page - 1) * limit)
      )
        throw new ApiError('http', {
          status: 400,
          message: 'Invalid member page.',
        });
      const result = requirePage(
        await api.envelope(
          path,
          (value) => {
            if (!Array.isArray(value) || value.length > limit)
              throw invalidResponse(200);
            const rows = value.map((item: unknown) => decodeBoardMember(item));
            if (
              new Set(rows.map(({ id }) => id)).size !== rows.length ||
              new Set(rows.map(({ user }) => user.id)).size !== rows.length
            )
              throw invalidResponse(200);
            return rows;
          },
          {
            ...options(signal),
            resourceKey: boardMembersKey(identity, board, page, limit),
            query: { page, limit },
            expectedStatus: 200,
          },
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
    add(email: string, signal: AbortSignal) {
      const normalized = boardMemberEmail(email);
      return api.json(
        path,
        (value) => {
          const member = decodeBoardMember(value, 201);
          if (
            member.role !== BoardRole.MEMBER ||
            member.user.email.toLowerCase() !== normalized ||
            member.user.isDeleted
          )
            throw invalidResponse(201);
          return member;
        },
        {
          ...options(signal),
          method: 'POST',
          body: { email: normalized },
          expectedStatus: 201,
        },
      );
    },
    changeRole(userId: string, role: BoardRole, signal: AbortSignal) {
      const target = id(userId, 400);
      if (role !== BoardRole.OWNER && role !== BoardRole.MEMBER)
        throw new ApiError('http', {
          status: 400,
          message: 'Choose OWNER or MEMBER.',
        });
      return api.json(
        `${path}/${encodeURIComponent(target)}`,
        (value) => {
          const member = decodeBoardMember(value);
          if (member.user.id !== target || member.role !== role)
            throw invalidResponse(200);
          return member;
        },
        {
          ...options(signal),
          method: 'PATCH',
          body: { role },
          expectedStatus: 200,
        },
      );
    },
    remove(userId: string, signal: AbortSignal) {
      return api.empty(`${path}/${encodeURIComponent(id(userId, 400))}`, {
        ...options(signal),
        method: 'DELETE',
        expectedStatus: 204,
      });
    },
  };
}
