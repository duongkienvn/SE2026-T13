import { BoardRoomCoordinator } from '../src/realtime/board-room-coordinator.service';

describe('BoardRoomCoordinator', () => {
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
