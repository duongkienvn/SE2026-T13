import { NotFoundException } from '@nestjs/common';
import { BoardPresenceService } from '../../src/realtime/board-presence.service';
import { BoardRoomCoordinator } from '../../src/realtime/board-room-coordinator.service';
import { BoardRoomRateLimiter } from '../../src/realtime/board-room-rate-limiter.service';
import { BoardRoomService } from '../../src/realtime/board-room.service';
import { RealtimeGateway } from '../../src/realtime/realtime.gateway';
import type { RealtimeAuthService } from '../../src/realtime/realtime-auth.service';
import type { BoardAuthorizationService } from '../../src/api/board-members/board-authorization.service';
import type {
  RealtimeServer,
  RealtimeSocket,
} from '../../src/realtime/realtime.types';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const A = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const B = 'd6ba7134-97ef-4c1b-a342-001a982a7721';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('Presence lifecycle concurrency', () => {
  let presence: BoardPresenceService;
  let coordinator: BoardRoomCoordinator;
  let limiter: BoardRoomRateLimiter;
  let rooms: BoardRoomService;
  let gateway: RealtimeGateway;
  let requireMember: jest.Mock;
  let sockets: Map<string, RealtimeSocket>;
  const makeSocket = (id: string, userId = id): RealtimeSocket =>
    ({
      id,
      connected: true,
      data: {
        identity: { userId, authVersion: 0, expiresAt: Date.now() + 60_000 },
      },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    }) as unknown as RealtimeSocket;
  beforeEach(() => {
    presence = new BoardPresenceService();
    coordinator = new BoardRoomCoordinator(presence);
    limiter = new BoardRoomRateLimiter();
    sockets = new Map([
      ['owner', makeSocket('owner')],
      ['member', makeSocket('member')],
    ]);
    coordinator.server = { sockets: { sockets } } as RealtimeServer;
    requireMember = jest.fn().mockResolvedValue({});
    const auth = {
      isActive: (s: RealtimeSocket) =>
        Boolean(s.connected && s.data.identity!.expiresAt > Date.now()),
      cleanup: jest.fn(),
    } as unknown as RealtimeAuthService;
    rooms = new BoardRoomService(
      { requireMember } as unknown as BoardAuthorizationService,
      auth,
      coordinator,
      limiter,
    );
    gateway = new RealtimeGateway(auth, coordinator, rooms);
  });
  afterEach(() => {
    limiter.onApplicationShutdown();
  });
  const state = (socket: RealtimeSocket) =>
    (socket.emit as jest.Mock).mock.calls.map((call) => call[1]);

  it.each(['authorization', 'adapter'])(
    'disconnect during %s prevents a late join from restoring presence',
    async (phase) => {
      const entered = deferred(),
        release = deferred();
      const member = sockets.get('member')!;
      const pause = async () => {
        entered.resolve();
        await release.promise;
      };
      if (phase === 'authorization')
        requireMember.mockImplementationOnce(pause);
      else (member.join as jest.Mock).mockImplementationOnce(pause);
      const joining = rooms.join(member, { boardId: A });
      await entered.promise;
      Object.defineProperty(member, 'connected', { value: false });
      await gateway.handleDisconnect(member);
      release.resolve();
      await expect(joining).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(presence.snapshot(A).userIds).toEqual([]);
      expect(member.data.authorizedBoardIds?.has(A)).not.toBe(true);
      expect(member.emit).not.toHaveBeenCalled();
      expect(presence['sockets'].size).toBe(0);
    },
  );

  it('serializes concurrent joins, duplicate joins and leave, emitting applied snapshots in order without nested locks', async () => {
    const owner = sockets.get('owner')!,
      member = sockets.get('member')!;
    const run = jest.spyOn(coordinator, 'run');
    await Promise.all([
      rooms.join(owner, { boardId: A }),
      rooms.join(member, { boardId: A }),
      rooms.join(member, { boardId: A }),
      rooms.leave(member, { boardId: A }),
    ]);
    expect(state(owner).map((s) => s.userIds)).toEqual([
      ['owner'],
      ['member', 'owner'],
      ['member', 'owner'],
      ['owner'],
    ]);
    expect(run).toHaveBeenCalledTimes(4);
    expect(presence.snapshot(A).userIds).toEqual(['owner']);
    expect(coordinator['pending'].size).toBe(0);
  });

  it('revokes a previously joined socket synchronously while its duplicate join is pending', async () => {
    const member = sockets.get('member')!,
      owner = sockets.get('owner')!;
    await rooms.join(owner, { boardId: A });
    await rooms.join(member, { boardId: A });
    const entered = deferred(),
      release = deferred();
    (member.join as jest.Mock).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    const joining = rooms.join(member, { boardId: A });
    await entered.promise;
    Object.defineProperty(member, 'connected', { value: false });
    const cleanup = gateway.handleDisconnect(member);
    expect(member.data.authorizedBoardIds!.size).toBe(0);
    release.resolve();
    await expect(joining).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
    await cleanup;
    expect(presence.snapshot(A).userIds).toEqual(['owner']);
    expect(state(owner).at(-1).userIds).toEqual(['owner']);
    expect(presence.boardIds(member.id)).toEqual([]);
    expect(coordinator['pending'].size).toBe(0);
  });

  it('queues eviction behind in-flight join and denies a later rejoin after membership removal', async () => {
    const entered = deferred(),
      release = deferred();
    const owner = sockets.get('owner')!,
      member = sockets.get('member')!;
    await rooms.join(owner, { boardId: A });
    (member.join as jest.Mock).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    const joining = rooms.join(member, { boardId: A });
    await entered.promise;
    const removal = coordinator.run(A, async () => {
      requireMember.mockRejectedValue(new NotFoundException());
      await coordinator.evictUser(A, 'member');
    });
    const rejoin = rooms.join(member, { boardId: A });
    release.resolve();
    await expect(joining).resolves.toMatchObject({ success: true });
    await removal;
    await expect(rejoin).resolves.toMatchObject({ code: 'NOT_FOUND' });
    expect(state(owner).at(-1).userIds).toEqual(['owner']);
    expect(state(member)).toEqual([
      { boardId: A, userIds: ['member', 'owner'] },
      { boardId: A, userId: 'member' },
    ]);
    expect(presence.snapshot(A).userIds).toEqual(['owner']);
  });

  it('revokes immediately during pending leave, handles repeated disconnect/evict and preserves other boards', async () => {
    const owner = sockets.get('owner')!,
      member = sockets.get('member')!;
    await rooms.join(owner, { boardId: A });
    await rooms.join(member, { boardId: A });
    await rooms.join(member, { boardId: B });
    const entered = deferred(),
      release = deferred();
    (member.leave as jest.Mock).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    const leaving = rooms.leave(member, { boardId: A });
    await entered.promise;
    expect(presence.snapshot(A).userIds).toEqual(['owner']);
    Object.defineProperty(member, 'connected', { value: false });
    const disconnecting = gateway.handleDisconnect(member);
    expect(member.data.authorizedBoardIds?.size).toBe(0);
    const eviction = coordinator.run(A, () =>
      coordinator.evictUser(A, 'member'),
    );
    release.resolve();
    await Promise.all([
      leaving,
      disconnecting,
      eviction,
      gateway.handleDisconnect(member),
    ]);
    expect(presence.snapshot(A).userIds).toEqual(['owner']);
    expect(presence.snapshot(B).userIds).toEqual([]);
    expect(presence.boardIds(member.id)).toEqual([]);
    const reconnected = makeSocket('new', 'member');
    sockets.set('new', reconnected);
    await rooms.join(reconnected, { boardId: A });
    expect(presence.snapshot(A).userIds).toEqual(['member', 'owner']);
    await gateway.handleDisconnect(member);
    expect(presence.snapshot(A).userIds).toEqual(['member', 'owner']);
  });

  it('cleans registry and grants on adapter failures; emission errors cannot fail committed eviction', async () => {
    const owner = sockets.get('owner')!,
      member = sockets.get('member')!;
    await rooms.join(owner, { boardId: A });
    await rooms.join(member, { boardId: A });
    await rooms.join(member, { boardId: B });
    const logs = [
      presence['logger'],
      coordinator['logger'],
      rooms['logger'],
    ].map((logger) => jest.spyOn(logger, 'error').mockImplementation());
    try {
      (member.leave as jest.Mock).mockRejectedValue(new Error('adapter'));
      await expect(rooms.leave(member, { boardId: A })).resolves.toMatchObject({
        code: 'INTERNAL_ERROR',
      });
      expect(presence.snapshot(A).userIds).toEqual(['owner']);
      await rooms.join(member, { boardId: A });
      (member.disconnect as jest.Mock).mockImplementation(() => {
        throw new Error('disconnect');
      });
      (owner.emit as jest.Mock).mockImplementation(() => {
        throw new Error('emit');
      });
      await expect(
        coordinator.run(A, () => coordinator.evictUser(A, 'member')),
      ).resolves.toBeUndefined();
      expect(presence.snapshot(A).userIds).toEqual(['owner']);
      expect(presence.snapshot(B).userIds).toEqual(['member']);
      expect(member.data.authorizedBoardIds?.has(A)).toBe(false);
      const before = state(member).length;
      coordinator.syncPresence(A);
      expect(state(member)).toHaveLength(before);
    } finally {
      logs.forEach((log) => log.mockRestore());
    }
  });

  it('cleans failed duplicate adapter joins and does not count a partially joined socket', async () => {
    const member = sockets.get('member')!;
    await rooms.join(member, { boardId: A });
    (member.join as jest.Mock).mockRejectedValue(new Error('adapter'));
    const log = jest.spyOn(rooms['logger'], 'error').mockImplementation();
    try {
      await expect(rooms.join(member, { boardId: A })).resolves.toMatchObject({
        code: 'INTERNAL_ERROR',
      });
      expect(member.data.authorizedBoardIds?.has(A)).toBe(false);
      expect(presence['boards'].size).toBe(0);
      expect(presence['sockets'].size).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});
