import type { BoardPresenceSnapshot } from '@kanban/shared';
import type { BoardRealtimeStatus } from './board-realtime-client';

export type BoardPresenceStatus = BoardRealtimeStatus | 'syncing';

export interface BoardPresenceState {
  readonly status: BoardPresenceStatus;
  /** null means no authoritative snapshot; [] is an authoritative empty board. */
  readonly userIds: readonly string[] | null;
}

export const EMPTY_PRESENCE = Object.freeze({
  connecting: Object.freeze({ status: 'connecting', userIds: null }),
  syncing: Object.freeze({ status: 'syncing', userIds: null }),
  reconnecting: Object.freeze({ status: 'reconnecting', userIds: null }),
  paused: Object.freeze({ status: 'paused', userIds: null }),
  unavailable: Object.freeze({ status: 'unavailable', userIds: null }),
} satisfies Record<Exclude<BoardPresenceStatus, 'live'>, BoardPresenceState>);

// Bound work before walking untrusted arrays. This is a defensive client limit,
// not a membership limit or an authorization decision.
export const MAX_PRESENCE_USERS = 10_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePresenceSnapshot(
  input: unknown,
): BoardPresenceSnapshot | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return null;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 2 ||
    typeof value.boardId !== 'string' ||
    !UUID.test(value.boardId) ||
    !Array.isArray(value.userIds) ||
    value.userIds.length > MAX_PRESENCE_USERS ||
    !Array.from(value.userIds).every(
      (id: unknown) => typeof id === 'string' && UUID.test(id),
    )
  )
    return null;
  return {
    boardId: value.boardId.toLowerCase(),
    userIds: [
      ...new Set((value.userIds as string[]).map((id) => id.toLowerCase())),
    ].sort(),
  };
}

export function livePresence(userIds: readonly string[]): BoardPresenceState {
  return Object.freeze({
    status: 'live',
    userIds: Object.freeze([...userIds]),
  });
}
