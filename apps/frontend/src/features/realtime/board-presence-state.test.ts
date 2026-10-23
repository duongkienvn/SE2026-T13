import { describe, expect, it } from 'vitest';
import {
  EMPTY_PRESENCE,
  livePresence,
  MAX_PRESENCE_USERS,
  parsePresenceSnapshot,
} from './board-presence-state';

const BOARD = '11111111-1111-4111-8111-11111111111a';
const USER = '22222222-2222-4222-8222-22222222222a';

describe('presence snapshot boundary', () => {
  it('consumes the G1 shape, canonicalizes IDs and returns sorted unique users', () => {
    expect(
      parsePresenceSnapshot({
        boardId: BOARD.toUpperCase(),
        userIds: [USER.toUpperCase(), BOARD, USER],
      }),
    ).toEqual({ boardId: BOARD, userIds: [BOARD, USER] });
    expect(parsePresenceSnapshot({ boardId: BOARD, userIds: [] })).toEqual({
      boardId: BOARD,
      userIds: [],
    });
  });
  it.each([
    null,
    undefined,
    [],
    {},
    'private',
    { boardId: 'bad', userIds: [] },
    { boardId: BOARD, userIds: 'bad' },
    { boardId: BOARD, userIds: [null] },
    { boardId: BOARD, userIds: Array(3) },
    { boardId: BOARD, userIds: ['invalid'] },
    { boardId: BOARD, userIds: [], email: 'private' },
    { boardId: BOARD, userIds: Array(MAX_PRESENCE_USERS + 1).fill(USER) },
  ])('ignores malformed or oversized payload %#', (input) => {
    expect(parsePresenceSnapshot(input)).toBeNull();
  });
  it('distinguishes no snapshot from an empty snapshot and exposes immutable data', () => {
    const ids = [USER];
    const live = livePresence(ids);
    ids.length = 0;
    expect(live.userIds).toEqual([USER]);
    expect(Object.isFrozen(live.userIds)).toBe(true);
    expect(EMPTY_PRESENCE.connecting.userIds).toBeNull();
    expect(livePresence([]).userIds).toEqual([]);
  });
});
