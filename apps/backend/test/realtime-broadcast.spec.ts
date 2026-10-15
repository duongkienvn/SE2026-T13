import './realtime.fixture';
import { BoardRoomCoordinator } from '../src/realtime/board-room-coordinator.service';
import { RealtimeBroadcastService } from '../src/realtime/realtime-broadcast.service';
import type { RealtimeAuthService } from '../src/realtime/realtime-auth.service';
import type { RealtimeServer } from '../src/realtime/realtime.types';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const BOARD = 'c6ba7134-97ef-4c1b-a342-001a982a7721';

describe('RealtimeBroadcastService', () => {
  it('targets one board and checks expiration before emitting', async () => {
    const coordinator = new BoardRoomCoordinator();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const isActive = jest.fn();
    const socket = { id: 's' };
    coordinator.server = {
      to,
      sockets: {
        adapter: { rooms: new Map([[`board:${BOARD}`, new Set(['s'])]]) },
        sockets: new Map([['s', socket]]),
      },
    } as unknown as RealtimeServer;
    const service = new RealtimeBroadcastService(coordinator, {
      isActive,
    } as unknown as RealtimeAuthService);
    await expect(
      service.emitToBoard(BOARD, 'test:board', { sequence: 1 }),
    ).resolves.toBe(true);
    expect(to).toHaveBeenCalledWith(`board:${BOARD}`);
    expect(emit).toHaveBeenCalledWith('test:board', { sequence: 1 });
    expect(isActive).toHaveBeenCalledWith(socket);
    expect(isActive.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0],
    );
    emit.mockImplementationOnce(() => {
      throw new Error('sensitive payload');
    });
    const log = jest.spyOn(service['logger'], 'error').mockImplementation();
    try {
      await expect(
        service.emitToBoard(BOARD, 'test:board', { sequence: 2 }),
      ).resolves.toBe(false);
      expect(log).toHaveBeenCalledWith('Board realtime broadcast failed');
    } finally {
      log.mockRestore();
    }
    coordinator.server = undefined;
    await expect(
      service.emitToBoard(BOARD, 'test:board', { sequence: 3 }),
    ).resolves.toBe(false);
  });
});
