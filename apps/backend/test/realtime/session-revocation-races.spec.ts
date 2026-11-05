import { AuthService } from '../../src/api/auth/auth.service';
import type { BoardAuthorizationService } from '../../src/api/board-members/board-authorization.service';
import { BoardPresenceService } from '../../src/realtime/board-presence.service';
import { BoardRoomCoordinator } from '../../src/realtime/board-room-coordinator.service';
import { BoardRoomRateLimiter } from '../../src/realtime/board-room-rate-limiter.service';
import { BoardRoomService } from '../../src/realtime/board-room.service';
import { RealtimeAuthService } from '../../src/realtime/realtime-auth.service';
import { RealtimeBroadcastService } from '../../src/realtime/realtime-broadcast.service';
import { RealtimeGateway } from '../../src/realtime/realtime.gateway';
import type {
  RealtimeServer,
  RealtimeSocket,
} from '../../src/realtime/realtime.types';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const boardId = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const userId = '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const identity = (authVersion: number, owner = userId) => ({
  userId: owner,
  authVersion,
  expiresAt: Date.now() + 60_000,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('local revocation versus in-flight Socket.IO handshakes', () => {
  let coordinator: BoardRoomCoordinator,
    auth: RealtimeAuthService,
    rooms: BoardRoomService,
    limiter: BoardRoomRateLimiter,
    gateway: RealtimeGateway;
  const authenticateAccessToken = jest.fn(),
    requireRead = jest.fn();
  let sockets: Map<string, RealtimeSocket>;
  beforeEach(() => {
    authenticateAccessToken.mockReset();
    requireRead.mockReset().mockResolvedValue({});
    coordinator = new BoardRoomCoordinator(new BoardPresenceService());
    sockets = new Map();
    coordinator.server = { sockets: { sockets } } as unknown as RealtimeServer;
    auth = new RealtimeAuthService(
      { authenticateAccessToken } as unknown as AuthService,
      coordinator,
    );
    limiter = new BoardRoomRateLimiter();
    rooms = new BoardRoomService(
      { requireRead } as unknown as BoardAuthorizationService,
      auth,
      coordinator,
      limiter,
    );
    gateway = new RealtimeGateway(auth, coordinator, rooms);
  });
  afterEach(() => {
    auth.onApplicationShutdown();
    limiter.onApplicationShutdown();
    coordinator.onApplicationShutdown();
  });
  const socket = (id = 'pending') =>
    ({
      id,
      connected: false,
      data: {},
      handshake: { auth: { accessToken: 'secret-jwt' } },
      disconnect: jest.fn(),
      onAny: jest.fn(),
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
    }) as unknown as RealtimeSocket;

  it('rejects the exact old-version lookup -> revocation scan -> lookup completion interleaving', async () => {
    const lookup = deferred<ReturnType<typeof identity>>();
    authenticateAccessToken.mockReturnValue(lookup.promise);
    const pending = socket();
    const outcome = auth.authenticate(pending);
    expect(sockets.size).toBe(0);
    expect(authenticateAccessToken).toHaveBeenCalledWith('secret-jwt');
    coordinator.revokeUserSessions(userId, 1);
    lookup.resolve(identity(0));
    await expect(outcome).rejects.toMatchObject({
      message: 'Unauthorized',
      data: { code: 'UNAUTHORIZED' },
    });
    expect(pending.data.identity).toBeUndefined();
    expect(pending.handshake.auth).not.toHaveProperty('accessToken');
    expect(await rooms.join(pending, { boardId })).toMatchObject({
      success: false,
      code: 'UNAUTHORIZED',
    });
    expect(requireRead).not.toHaveBeenCalled();
  });
  it('passes a sanitized handshake error to Socket.IO instead of accepting the stale credential', async () => {
    let middleware!: (
      socket: RealtimeSocket,
      next: (error?: Error) => void,
    ) => void;
    gateway.afterInit({
      sockets: { sockets },
      use: (handler: typeof middleware) => {
        middleware = handler;
      },
    } as unknown as RealtimeServer);
    const lookup = deferred<ReturnType<typeof identity>>();
    authenticateAccessToken.mockReturnValue(lookup.promise);
    const pending = socket();
    const done = deferred<Error | undefined>();
    middleware(pending, (error) => done.resolve(error));
    coordinator.revokeUserSessions(userId, 1);
    lookup.resolve(identity(0));
    expect(await done.promise).toMatchObject({
      message: 'Unauthorized',
      data: { code: 'UNAUTHORIZED' },
    });
  });
  it('denies a socket published after authentication finished and after the revocation scan', async () => {
    authenticateAccessToken.mockResolvedValue(identity(0));
    const pending = socket();
    await auth.authenticate(pending);
    coordinator.revokeUserSessions(userId, 1); // pending still absent from namespace
    Object.assign(pending, { connected: true });
    sockets.set(pending.id, pending);
    // A failed disconnect must not leave logical access usable.
    const log = jest.spyOn(auth['logger'], 'error').mockImplementation();
    (pending.disconnect as jest.Mock).mockImplementation(() => {
      throw new Error('adapter failure');
    });
    try {
      gateway.handleConnection(pending);
      expect(auth.isActive(pending)).toBe(false);
      expect(await rooms.join(pending, { boardId })).toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(pending.join).not.toHaveBeenCalled();
      expect(requireRead).not.toHaveBeenCalled();
      expect(pending.data.authorizedBoardIds?.size ?? 0).toBe(0);
      await coordinator.run(boardId, () => coordinator.syncPresence(boardId));
      await new RealtimeBroadcastService(coordinator, auth).emitToBoard(
        boardId,
        'board:archived',
        { boardId },
      );
      expect(pending.emit).not.toHaveBeenCalled();
      expect(coordinator.presence.snapshot(boardId).userIds).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
  it('clears stale receive grants and presence when isActive encounters a socket missed by the scan', async () => {
    authenticateAccessToken.mockResolvedValue(identity(0));
    const pending = socket();
    await auth.authenticate(pending);
    coordinator.revokeUserSessions(userId, 1);
    Object.assign(pending, { connected: true });
    sockets.set(pending.id, pending);
    pending.data.authorizedBoardIds = new Set([boardId]);
    coordinator.presence.add(boardId, userId, pending.id);
    const broadcast = new RealtimeBroadcastService(coordinator, auth);
    await broadcast.emitToBoard(boardId, 'board:archived', { boardId });
    await coordinator.run(boardId, () => coordinator.syncPresence(boardId));
    expect(pending.data.authorizedBoardIds.size).toBe(0);
    expect(coordinator.presence.boardIds(pending.id)).toEqual([]);
    expect(pending.emit).not.toHaveBeenCalled();
  });
  it('keeps a monotonic watermark and preserves current-version sockets and other users', async () => {
    coordinator.revokeUserSessions(userId, 2);
    coordinator.revokeUserSessions(userId, 1);
    authenticateAccessToken.mockResolvedValueOnce(identity(1));
    await expect(auth.authenticate(socket('old'))).rejects.toThrow(
      'Unauthorized',
    );
    for (const [id, owner, version] of [
      ['current', userId, 2],
      ['other', 'other-user', 0],
    ] as const) {
      const valid = socket(id);
      authenticateAccessToken.mockResolvedValueOnce(identity(version, owner));
      await auth.authenticate(valid);
      Object.assign(valid, { connected: true });
      sockets.set(id, valid);
      gateway.handleConnection(valid);
      expect(await rooms.join(valid, { boardId })).toMatchObject({
        success: true,
      });
      expect(auth.isActive(valid)).toBe(true);
      expect(valid.disconnect).not.toHaveBeenCalled();
    }
    await new RealtimeBroadcastService(coordinator, auth).emitToBoard(
      boardId,
      'board:archived',
      { boardId },
    );
    for (const valid of sockets.values())
      expect(valid.emit).toHaveBeenCalledWith('board:archived', { boardId });
    expect(coordinator.presence.snapshot(boardId).userIds).toEqual(
      ['other-user', userId].sort(),
    );
  });
  it('clears process-local watermarks on shutdown', () => {
    coordinator.revokeUserSessions(userId, 1);
    expect(coordinator.isSessionRevoked(identity(0))).toBe(true);
    coordinator.onApplicationShutdown();
    expect(coordinator.isSessionRevoked(identity(0))).toBe(false);
  });
});
