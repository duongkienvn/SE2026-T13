import type { BoardMember } from '../features/board-members/types';
import type { Board } from '../features/boards/types';
import { testUser, type MockResponse } from './mock-api';

let sequence = 0;

/** A board as returned by the Board Management API (#20). */
export function makeBoard(overrides: Partial<Board> = {}): Board {
  sequence += 1;
  const id = `00000000-0000-4000-9000-${String(sequence).padStart(12, '0')}`;
  return {
    id,
    name: `Board ${sequence}`,
    description: null,
    createdById: testUser.id,
    isArchived: false,
    archivedAt: null,
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
    currentUserRole: 'OWNER',
    ...overrides,
  };
}

export function makeMember(overrides: Partial<BoardMember> = {}): BoardMember {
  return {
    user: {
      id: testUser.id,
      email: testUser.email,
      displayName: testUser.displayName,
      avatarUrl: null,
    },
    role: 'OWNER',
    joinedAt: '2026-10-12T00:00:00.000Z',
    ...overrides,
  };
}

/** Paginated success envelope (`data` + `meta`) as used by list endpoints. */
export function okPage<T>(
  items: T[],
  { page = 1, limit = 100, total = items.length } = {},
): MockResponse {
  return {
    status: 200,
    body: {
      success: true,
      statusCode: 200,
      message: 'OK',
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    },
  };
}
