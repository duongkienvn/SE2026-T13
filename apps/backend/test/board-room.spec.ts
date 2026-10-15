import { NotFoundException } from '@nestjs/common';
import type { BoardAuthorizationService } from '../src/api/board-members/board-authorization.service';
import { BoardRoomCoordinator } from '../src/realtime/board-room-coordinator.service';
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
  beforeEach(() => {
    jest.resetAllMocks();
    requireMember.mockResolvedValue({ board: { isArchived: true } });
    isActive.mockReturnValue(true);
    socket = {
      data: { identity: { userId: 'verified' } },
      join: jest.fn(),
      leave: jest.fn(),
    } as unknown as RealtimeSocket;
    service = new BoardRoomService(
      { requireMember } as unknown as BoardAuthorizationService,
      { isActive } as unknown as RealtimeAuthService,
      new BoardRoomCoordinator(),
    );
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
