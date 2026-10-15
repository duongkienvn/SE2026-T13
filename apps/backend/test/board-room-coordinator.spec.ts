import { BoardRoomCoordinator } from '../src/realtime/board-room-coordinator.service';
import type { RealtimeServer } from '../src/realtime/realtime.types';

describe('BoardRoomCoordinator', () => {
  it('evicts every socket of a revoked user only from the target board', async () => {
    const coordinator = new BoardRoomCoordinator();
    const makeSocket = (userId: string) => ({
      data: { identity: { userId } },
      rooms: new Set(['board:a', 'board:b']),
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
    await coordinator.evictUser('a', 'revoked');
    expect(first.leave).toHaveBeenCalledWith('board:a');
    expect(second.leave).toHaveBeenCalledWith('board:a');
    expect(other.leave).not.toHaveBeenCalled();
    first.leave.mockRejectedValue(new Error('transport failure'));
    const log = jest.spyOn(coordinator['logger'], 'error').mockImplementation();
    try {
      await expect(
        coordinator.evictUser('a', 'revoked'),
      ).resolves.toBeUndefined();
      expect(first.disconnect).toHaveBeenCalledWith(true);
      expect(log).toHaveBeenCalledWith(
        'Board room eviction failed; disconnecting socket',
      );
    } finally {
      log.mockRestore();
    }
  });
  it('orders operations on a board, allows other boards and releases failures', async () => {
    const coordinator = new BoardRoomCoordinator();
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
