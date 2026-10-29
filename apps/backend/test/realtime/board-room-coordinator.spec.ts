import { BoardPresenceService } from '../../src/realtime/board-presence.service';
import { BoardRoomCoordinator } from '../../src/realtime/board-room-coordinator.service';
import type { RealtimeServer } from '../../src/realtime/realtime.types';

describe('BoardRoomCoordinator', () => {
  it('sends identifier-free access hints only to affected unexpired sessions', () => {
    const coordinator = new BoardRoomCoordinator(new BoardPresenceService());
    const socket = (userId: string, expiresAt: number, connected = true) => ({
      connected,
      data: { identity: { userId, expiresAt } },
      emit: jest.fn(),
    });
    const allowed = socket('allowed', Date.now() + 60_000);
    const other = socket('other', Date.now() + 60_000);
    const expired = socket('allowed', Date.now() - 1);
    const offline = socket('allowed', Date.now() + 60_000, false);
    coordinator.server = {
      sockets: {
        sockets: new Map([
          ['allowed', allowed],
          ['other', other],
          ['expired', expired],
          ['offline', offline],
        ]),
      },
    } as unknown as RealtimeServer;
    coordinator.notifyAccessChanged(['allowed']);
    expect(allowed.emit).toHaveBeenCalledWith('access:changed');
    expect(other.emit).not.toHaveBeenCalled();
    expect(expired.emit).not.toHaveBeenCalled();
    expect(offline.emit).not.toHaveBeenCalled();
  });
  it('evicts every socket of a revoked user only from the target board', async () => {
    const coordinator = new BoardRoomCoordinator(new BoardPresenceService());
    const makeSocket = (userId: string) => ({
      data: { identity: { userId }, authorizedBoardIds: new Set(['a', 'b']) },
      rooms: new Set(['board:a', 'board:b']),
      emit: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
    });
    const first = makeSocket('revoked');
    const second = makeSocket('revoked');
    const other = makeSocket('owner');
    coordinator.server = {
      sockets: {
        sockets: new Map([
          ['one', first],
          ['two', second],
          ['other', other],
        ]),
      },
    } as unknown as RealtimeServer;
    first.emit.mockImplementation(() => {
      expect(first.data.authorizedBoardIds.has('a')).toBe(false);
      expect(second.data.authorizedBoardIds.has('a')).toBe(false);
    });
    await coordinator.evictUser('a', 'revoked');
    expect(first.emit).toHaveBeenCalledWith('member:removed', {
      boardId: 'a',
      userId: 'revoked',
    });
    expect(second.emit).toHaveBeenCalledWith('member:removed', {
      boardId: 'a',
      userId: 'revoked',
    });
    expect(other.emit).not.toHaveBeenCalled();
    expect(first.emit.mock.invocationCallOrder[0]).toBeLessThan(
      first.leave.mock.invocationCallOrder[0],
    );
    expect(first.leave).toHaveBeenCalledWith('board:a');
    expect(second.leave).toHaveBeenCalledWith('board:a');
    expect(other.leave).not.toHaveBeenCalled();
    expect([...first.data.authorizedBoardIds]).toEqual(['b']);
    expect([...second.data.authorizedBoardIds]).toEqual(['b']);
    expect([...other.data.authorizedBoardIds]).toEqual(['a', 'b']);
    first.leave.mockRejectedValue(new Error('transport failure'));
    const log = jest.spyOn(coordinator['logger'], 'error').mockImplementation();
    try {
      await expect(
        coordinator.evictUser('a', 'revoked'),
      ).resolves.toBeUndefined();
      expect(first.disconnect).toHaveBeenCalledWith(true);
      first.emit.mockImplementationOnce(() => {
        throw new Error('notification failed');
      });
      await expect(
        coordinator.evictUser('a', 'revoked'),
      ).resolves.toBeUndefined();
      expect(second.emit).toHaveBeenCalledTimes(3);
      expect(log).toHaveBeenCalledWith(
        'Board room eviction failed; disconnecting socket',
      );
    } finally {
      log.mockRestore();
    }
  });
  it('revokes all receive grants and continues eviction when leave and disconnect both fail', async () => {
    const coordinator = new BoardRoomCoordinator(new BoardPresenceService());
    const makeSocket = () => ({
      data: {
        identity: { userId: 'revoked' },
        authorizedBoardIds: new Set(['a', 'b']),
      },
      emit: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
    });
    const broken = makeSocket();
    const healthy = makeSocket();
    broken.leave.mockImplementation(async () => {
      expect(broken.data.authorizedBoardIds.has('a')).toBe(false);
      expect(healthy.data.authorizedBoardIds.has('a')).toBe(false);
      throw new Error('sensitive adapter failure');
    });
    broken.disconnect.mockImplementation(() => {
      throw new Error('sensitive transport failure');
    });
    coordinator.server = {
      sockets: {
        sockets: new Map([
          ['broken', broken],
          ['healthy', healthy],
        ]),
      },
    } as unknown as RealtimeServer;
    const log = jest.spyOn(coordinator['logger'], 'error').mockImplementation();
    try {
      await expect(
        coordinator.evictUser('A', 'revoked'),
      ).resolves.toBeUndefined();
      expect(broken.disconnect).toHaveBeenCalledWith(true);
      expect(healthy.leave).toHaveBeenCalledWith('board:a');
      expect(broken.data.authorizedBoardIds.has('b')).toBe(true);
      expect(log).toHaveBeenCalledWith(
        'Socket disconnect failed; board receive access remains revoked',
      );
    } finally {
      log.mockRestore();
    }
  });
  it('orders operations on a board, allows other boards and releases failures', async () => {
    const coordinator = new BoardRoomCoordinator(new BoardPresenceService());
    const order: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const first = coordinator.run('A', async () => {
      order.push('removing');
      await barrier;
      order.push('evicted');
    });
    const second = coordinator.run('a', () => order.push('broadcast'));
    await coordinator.run('B', () => order.push('other board'));
    expect(order).toEqual(['removing', 'other board']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['removing', 'other board', 'evicted', 'broadcast']);
    await expect(
      coordinator.run('A', () => Promise.reject(new Error('rollback'))),
    ).rejects.toThrow('rollback');
    await expect(coordinator.run('A', () => 'released')).resolves.toBe(
      'released',
    );
    expect(coordinator['pending'].size).toBe(0);
  });
});
