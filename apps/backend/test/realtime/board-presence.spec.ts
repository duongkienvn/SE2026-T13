import { BoardPresenceService } from '../../src/realtime/board-presence.service';
import type {
  RealtimeServer,
  RealtimeSocket,
} from '../../src/realtime/realtime.types';

const A = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const B = 'd6ba7134-97ef-4c1b-a342-001a982a7721';

describe('BoardPresenceService', () => {
  let presence: BoardPresenceService;
  beforeEach(() => {
    presence = new BoardPresenceService();
  });

  it('handles first/duplicate joins, multiple users and tabs with sorted unique snapshots', () => {
    presence.add(A.toUpperCase(), 'z', 's1');
    expect(presence.snapshot(A)).toEqual({ boardId: A, userIds: ['z'] });
    presence.add(A, 'z', 's1');
    presence.add(A, 'z', 's2');
    presence.add(A, 'a', 's3');
    expect(presence.snapshot(A)).toEqual({ boardId: A, userIds: ['a', 'z'] });
    presence.remove(A, 's1');
    expect(presence.snapshot(A).userIds).toEqual(['a', 'z']);
    presence.remove(A, 's2');
    presence.remove(A, 's2');
    expect(presence.snapshot(A).userIds).toEqual(['a']);
    presence.remove(A, 's3');
    expect(presence.snapshot(A).userIds).toEqual([]);
    expect(presence['boards'].size).toBe(0);
    expect(presence['sockets'].size).toBe(0);
  });

  it('isolates boards and cleans reverse indices on user eviction and shutdown', () => {
    presence.add(A, 'user', 's1');
    presence.add(A, 'user', 's2');
    presence.add(B, 'user', 's1');
    expect(presence.boardIds('s1')).toEqual([A, B]);
    presence.removeUser(A.toUpperCase(), 'user');
    presence.removeUser(A, 'user');
    expect(presence.snapshot(A).userIds).toEqual([]);
    expect(presence.snapshot(B).userIds).toEqual(['user']);
    expect(presence.boardIds('s1')).toEqual([B]);
    expect(presence.boardIds('s2')).toEqual([]);
    const snapshot = presence.snapshot(B);
    snapshot.userIds.length = 0;
    expect(presence.snapshot(B).userIds).toEqual(['user']);
    presence.onApplicationShutdown();
    expect(presence['boards'].size).toBe(0);
    expect(presence['sockets'].size).toBe(0);
  });

  it('prunes missing, disconnected, expired, mismatched and revoked sockets before delivery', () => {
    const sockets = new Map<string, RealtimeSocket>();
    for (const id of [
      'ok',
      'missing',
      'closed',
      'expired',
      'forged',
      'revoked',
      'other',
    ]) {
      const board = id === 'other' ? B : A;
      presence.add(board, id, id);
      if (id === 'missing') continue;
      sockets.set(id, {
        id,
        connected: id !== 'closed',
        emit: jest.fn(),
        data: {
          identity: {
            userId: id === 'forged' ? 'different' : id,
            expiresAt: Date.now() + (id === 'expired' ? -1 : 60_000),
          },
          authorizedBoardIds: new Set(id === 'revoked' ? [] : [board]),
        },
      } as unknown as RealtimeSocket);
    }
    presence.sync(A, { sockets: { sockets } } as RealtimeServer);
    expect(presence.snapshot(A).userIds).toEqual(['ok']);
    expect(sockets.get('ok')!.emit).toHaveBeenCalledWith('presence:sync', {
      boardId: A,
      userIds: ['ok'],
    });
    for (const id of ['closed', 'expired', 'forged', 'revoked', 'other']) {
      expect(sockets.get(id)!.emit).not.toHaveBeenCalled();
    }
    expect(presence['sockets'].size).toBe(2);
  });

  it('contains per-recipient failures and continues with the applied snapshot', () => {
    const broken = {
      id: 'a',
      connected: true,
      data: {
        identity: { userId: 'a', expiresAt: Date.now() + 60_000 },
        authorizedBoardIds: new Set([A]),
      },
      emit: jest.fn(() => {
        throw new Error('private');
      }),
    };
    const healthy = {
      ...broken,
      id: 'b',
      data: {
        ...broken.data,
        identity: { ...broken.data.identity, userId: 'b' },
      },
      emit: jest.fn(),
    };
    presence.add(A, 'a', 'a');
    presence.add(A, 'b', 'b');
    const log = jest.spyOn(presence['logger'], 'error').mockImplementation();
    try {
      presence.sync(A, {
        sockets: {
          sockets: new Map([
            ['a', broken],
            ['b', healthy],
          ]),
        },
      } as unknown as RealtimeServer);
      expect(healthy.emit).toHaveBeenCalledWith('presence:sync', {
        boardId: A,
        userIds: ['a', 'b'],
      });
      expect(log).toHaveBeenCalledWith('Board presence delivery failed');
      expect(presence.snapshot(A).userIds).toEqual(['a', 'b']);
    } finally {
      log.mockRestore();
    }
  });
});
