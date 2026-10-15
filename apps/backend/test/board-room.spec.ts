import { NotFoundException } from '@nestjs/common';
import type { BoardAuthorizationService } from '../src/api/board-members/board-authorization.service';
import { BoardRoomCoordinator } from '../src/realtime/board-room-coordinator.service';
import {
  BoardRoomRateLimiter,
  BOARD_ROOM_REQUEST_LIMITS,
} from '../src/realtime/board-room-rate-limiter.service';
import { BoardRoomService } from '../src/realtime/board-room.service';
import type { RealtimeAuthService } from '../src/realtime/realtime-auth.service';
import type { RealtimeSocket } from '../src/realtime/realtime.types';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

const BOARD = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
describe('BoardRoomService', () => {
  const requireMember = jest.fn();
  const isActive = jest.fn();
  let service: BoardRoomService;
  let socket: RealtimeSocket;
  let coordinator: BoardRoomCoordinator;
  let limiter: BoardRoomRateLimiter;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    requireMember.mockResolvedValue({ board: { isArchived: true } });
    isActive.mockReturnValue(true);
    socket = {
      data: { identity: { userId: 'verified' } },
      join: jest.fn(),
      leave: jest.fn(),
    } as unknown as RealtimeSocket;
    coordinator = new BoardRoomCoordinator();
    limiter = new BoardRoomRateLimiter();
    service = new BoardRoomService(
      { requireMember } as unknown as BoardAuthorizationService,
      { isActive } as unknown as RealtimeAuthService,
      coordinator,
      limiter,
    );
  });
  afterEach(() => {
    limiter.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('shares the rate window across board IDs, events and sockets; resets at its boundary', async () => {
    const otherTab = {
      ...socket,
      data: { identity: { userId: 'verified' } },
    } as RealtimeSocket;
    for (let index = 0; index < BOARD_ROOM_REQUEST_LIMITS.requests; index++) {
      const boardId = `${index.toString(16).padStart(8, '0')}${BOARD.slice(8)}`;
      const result =
        index % 2
          ? await service.leave(otherTab, { boardId })
          : await service.join(socket, { boardId });
      expect(result.success).toBe(true);
    }
    const queries = requireMember.mock.calls.length;
    await expect(service.join(otherTab, { boardId: BOARD })).resolves.toEqual({
      success: false,
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many board room requests',
    });
    await expect(
      service.leave(socket, { boardId: BOARD }),
    ).resolves.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(requireMember).toHaveBeenCalledTimes(queries);
    jest.advanceTimersByTime(BOARD_ROOM_REQUEST_LIMITS.windowMs - 1);
    await expect(
      service.join(socket, { boardId: BOARD }),
    ).resolves.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    jest.advanceTimersByTime(1);
    await expect(
      service.join(socket, { boardId: BOARD }),
    ).resolves.toMatchObject({ success: true });
    otherTab.data.identity = {
      userId: 'different-user',
      expiresAt: Date.now() + 60_000,
    };
    await expect(
      service.join(otherTab, { boardId: BOARD }),
    ).resolves.toMatchObject({ success: true });
  });

  it('bounds queued requests even across windows while authorization is stalled', async () => {
    let resume!: () => void;
    const blocked = new Promise<void>((resolve) => (resume = resolve));
    requireMember.mockReturnValue(blocked);
    const run = jest.spyOn(coordinator, 'run');
    const admitted = Array.from(
      { length: BOARD_ROOM_REQUEST_LIMITS.pending },
      () => service.join(socket, { boardId: BOARD }),
    );
    const burst = await Promise.all(
      Array.from({ length: 100 }, () =>
        service.join(socket, { boardId: BOARD }),
      ),
    );
    expect(
      burst.every((ack) => !ack.success && ack.code === 'TOO_MANY_REQUESTS'),
    ).toBe(true);
    expect(run).toHaveBeenCalledTimes(BOARD_ROOM_REQUEST_LIMITS.pending);
    expect(requireMember).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(BOARD_ROOM_REQUEST_LIMITS.windowMs * 2);
    await expect(
      service.leave(socket, { boardId: BOARD }),
    ).resolves.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    resume();
    expect((await Promise.all(admitted)).every((ack) => ack.success)).toBe(
      true,
    );
    await expect(
      service.leave(socket, { boardId: BOARD }),
    ).resolves.toMatchObject({ success: true });
  });

  it('charges malformed requests and releases permits after validation and storage failures', async () => {
    const run = jest.spyOn(coordinator, 'run');
    for (let index = 0; index < BOARD_ROOM_REQUEST_LIMITS.requests; index++) {
      await expect(service.join(socket, null)).resolves.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    await expect(
      service.join(socket, { boardId: BOARD }),
    ).resolves.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(run).not.toHaveBeenCalled();
    expect(requireMember).not.toHaveBeenCalled();
    jest.advanceTimersByTime(BOARD_ROOM_REQUEST_LIMITS.windowMs);
    requireMember.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.join(socket, { boardId: BOARD }),
    ).resolves.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.join(socket, { boardId: BOARD }),
    ).resolves.toMatchObject({ success: true });
  });

  it('authorizes using server identity before joining, including archived boards', async () => {
    await expect(
      service.join(socket, { boardId: BOARD.toUpperCase() }),
    ).resolves.toEqual({ success: true, boardId: BOARD });
    expect(requireMember).toHaveBeenCalledWith('verified', BOARD);
    expect(socket.join).toHaveBeenCalledWith(`board:${BOARD}`);
    expect(requireMember.mock.invocationCallOrder[0]).toBeLessThan(
      (socket.join as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it.each([
    null,
    undefined,
    [],
    'board:any',
    {},
    { boardId: 1 },
    { boardId: 'bad' },
    { boardId: BOARD, userId: 'forged' },
    { boardId: BOARD, room: 'arbitrary' },
  ])('rejects malformed or extra fields: %j', async (payload) => {
    await expect(service.join(socket, payload)).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION_FAILED',
    });
    expect(socket.join).not.toHaveBeenCalled();
    expect(requireMember).not.toHaveBeenCalled();
  });

  it('hides missing board and nonmembership behind the same acknowledgement', async () => {
    requireMember.mockRejectedValue(
      new NotFoundException('private information'),
    );
    await expect(service.join(socket, { boardId: BOARD })).resolves.toEqual({
      success: false,
      code: 'NOT_FOUND',
      message: 'Board not found',
    });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rechecks expiration after asynchronous authorization', async () => {
    isActive
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    await expect(
      service.join(socket, { boardId: BOARD }),
    ).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('orders removal after a join whose authorization is already in flight', async () => {
    const order: string[] = [];
    let release!: () => void;
    let checked!: () => void;
    const reading = new Promise<void>((resolve) => (checked = resolve));
    const barrier = new Promise<void>((resolve) => (release = resolve));
    requireMember.mockImplementationOnce(async () => {
      checked();
      await barrier;
    });
    (socket.join as jest.Mock).mockImplementation(() => order.push('join'));
    const joining = service.join(socket, { boardId: BOARD });
    await reading;
    const removal = coordinator.run(BOARD, () =>
      order.push('commit and evict'),
    );
    const broadcast = coordinator.run(BOARD, () => order.push('broadcast'));
    expect(order).toEqual([]);
    release();
    await Promise.all([joining, removal, broadcast]);
    expect(order).toEqual(['join', 'commit and evict', 'broadcast']);
  });

  it('removes a late room join when the socket disconnects during adapter work', async () => {
    (socket.join as jest.Mock).mockImplementation(() =>
      isActive.mockReturnValue(false),
    );
    await expect(
      service.join(socket, { boardId: BOARD }),
    ).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(socket.leave).toHaveBeenCalledWith(`board:${BOARD}`);
  });

  it('leaves exactly the requested board and tolerates repeated leave', async () => {
    await service.leave(socket, { boardId: BOARD });
    await service.leave(socket, { boardId: BOARD });
    expect(socket.leave).toHaveBeenCalledTimes(2);
    expect(socket.leave).toHaveBeenLastCalledWith(`board:${BOARD}`);
    expect(requireMember).not.toHaveBeenCalled();
  });

  it('returns sanitized failure and keeps serving when authorization storage fails', async () => {
    const log = jest.spyOn(service['logger'], 'error').mockImplementation();
    try {
      requireMember.mockRejectedValueOnce(new Error('SQL and secrets'));
      await expect(
        service.join(socket, { boardId: BOARD }),
      ).resolves.toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Unable to update board room',
      });
      expect(log).toHaveBeenCalledWith('Board room operation failed');
      await expect(
        service.join(socket, { boardId: BOARD }),
      ).resolves.toMatchObject({ success: true });
    } finally {
      log.mockRestore();
    }
  });
});
