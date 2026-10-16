import './realtime.fixture';
import { BoardRoomCoordinator } from '../../src/realtime/board-room-coordinator.service';
import { RealtimeBroadcastService } from '../../src/realtime/realtime-broadcast.service';
import type { RealtimeAuthService } from '../../src/realtime/realtime-auth.service';
import type { RealtimeServer } from '../../src/realtime/realtime.types';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const BOARD = 'c6ba7134-97ef-4c1b-a342-001a982a7721';

describe('RealtimeBroadcastService', () => {
  it('targets granted board recipients and checks expiration before emitting', async () => {
    const coordinator = new BoardRoomCoordinator();
    const emit = jest.fn();
    const isActive = jest.fn().mockReturnValue(true);
    const socket = {
      id: 's',
      emit,
      data: { authorizedBoardIds: new Set([BOARD]) },
    };
    coordinator.server = {
      sockets: {
        sockets: new Map([['s', socket]]),
      },
    } as unknown as RealtimeServer;
    const service = new RealtimeBroadcastService(coordinator, {
      isActive,
    } as unknown as RealtimeAuthService);
    await expect(
      service.emitToBoard(BOARD, 'test:board', { sequence: 1 }),
    ).resolves.toBe(true);
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

  it('excludes revoked sockets despite stale rooms and double transport failure, preserving other boards', async () => {
    const coordinator = new BoardRoomCoordinator();
    const otherBoard = 'd6ba7134-97ef-4c1b-a342-001a982a7721';
    const makeSocket = (id: string, boards: string[]) => ({
      id,
      data: { identity: { userId: id }, authorizedBoardIds: new Set(boards) },
      rooms: new Set(boards.map((board) => `board:${board}`)),
      emit: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
    });
    const revoked = makeSocket('revoked', [BOARD, otherBoard]);
    const owner = makeSocket('owner', [BOARD]);
    const other = makeSocket('other', [otherBoard]);
    const unauthorized = makeSocket('unauthorized', []);
    const expired = makeSocket('expired', [BOARD]);
    revoked.leave.mockRejectedValue(new Error('leave failed'));
    revoked.disconnect.mockImplementation(() => {
      throw new Error('disconnect failed');
    });
    coordinator.server = {
      sockets: {
        sockets: new Map(
          [revoked, owner, other, unauthorized, expired].map((s) => [s.id, s]),
        ),
      },
    } as unknown as RealtimeServer;
    const isActive = jest.fn((socket) => socket !== expired);
    const service = new RealtimeBroadcastService(coordinator, {
      isActive,
    } as unknown as RealtimeAuthService);
    const log = jest.spyOn(coordinator['logger'], 'error').mockImplementation();
    try {
      await coordinator.run(BOARD, () =>
        coordinator.evictUser(BOARD, 'revoked'),
      );
      expect(revoked.rooms.has(`board:${BOARD}`)).toBe(true);
      await expect(
        service.emitToBoard(BOARD.toUpperCase(), 'test:board', { sequence: 1 }),
      ).resolves.toBe(true);
      expect(owner.emit).toHaveBeenCalledWith('test:board', { sequence: 1 });
      for (const socket of [revoked, other, unauthorized, expired])
        expect(socket.emit).not.toHaveBeenCalled();
      expect(isActive).not.toHaveBeenCalledWith(revoked);
      await service.emitToBoard(otherBoard, 'test:board', { sequence: 2 });
      expect(revoked.emit).toHaveBeenCalledWith('test:board', { sequence: 2 });
      expect(other.emit).toHaveBeenCalledWith('test:board', { sequence: 2 });
      await expect(
        service.emitToBoard(
          'e6ba7134-97ef-4c1b-a342-001a982a7721',
          'test:board',
          { sequence: 3 },
        ),
      ).resolves.toBe(true);
      expect(owner.emit).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});
