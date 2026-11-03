import { AuthService } from '../../src/api/auth/auth.service';
import { BoardPresenceService } from '../../src/realtime/board-presence.service';
import { BoardRoomCoordinator } from '../../src/realtime/board-room-coordinator.service';
import { RealtimeAuthService } from '../../src/realtime/realtime-auth.service';
import { RealtimeBroadcastService } from '../../src/realtime/realtime-broadcast.service';
import { NotificationEventPublisher } from '../../src/realtime/notification-event-publisher.service';
import type {
  RealtimeServer,
  RealtimeSocket,
} from '../../src/realtime/realtime.types';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const A = 'c6ba7134-97ef-4c1b-a342-001a982a7721',
  B = 'd6ba7134-97ef-4c1b-a342-001a982a7721';
describe('private notification realtime ownership', () => {
  let auth: RealtimeAuthService,
    coordinator: BoardRoomCoordinator,
    broadcast: RealtimeBroadcastService;
  const currentSocketAuthVersion = jest.fn().mockResolvedValue(0);
  const socket = async (id: string, userId: string, ttl = 60000) => {
    const value = {
      id,
      connected: true,
      data: {},
      handshake: { auth: { accessToken: userId } },
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as RealtimeSocket;
    await auth.authenticate(value);
    (coordinator.server!.sockets.sockets as Map<string, RealtimeSocket>).set(
      id,
      value,
    );
    if (ttl < 0)
      value.data.identity = {
        ...value.data.identity!,
        expiresAt: Date.now() - 1,
      };
    return value;
  };
  beforeEach(() => {
    jest.clearAllMocks();
    currentSocketAuthVersion.mockResolvedValue(0);
    coordinator = new BoardRoomCoordinator(new BoardPresenceService());
    coordinator.server = {
      sockets: { sockets: new Map() },
    } as unknown as RealtimeServer;
    auth = new RealtimeAuthService(
      {
        authenticateAccessToken: async (userId: string) => ({
          userId,
          authVersion: 0,
          expiresAt: Date.now() + 60000,
        }),
        currentSocketAuthVersion,
      } as unknown as AuthService,
      coordinator,
    );
    broadcast = new RealtimeBroadcastService(coordinator, auth);
  });
  afterEach(() => auth.onApplicationShutdown());
  it('selects all current owner tabs without rooms; excludes other, expired and disconnected sockets', async () => {
    const a = await socket('a', A),
      tab = await socket('tab', A),
      other = await socket('b', B),
      expired = await socket('expired', A, -1),
      gone = await socket('gone', A);
    Object.defineProperty(gone, 'connected', { value: false });
    expect(await broadcast.emitToUser(A, 'notifications:changed', {})).toBe(
      true,
    );
    expect(a.emit).toHaveBeenCalledWith('notifications:changed', {});
    expect(tab.emit).toHaveBeenCalledTimes(1);
    for (const value of [other, expired, gone])
      expect(value.emit).not.toHaveBeenCalled();
    expect(currentSocketAuthVersion).toHaveBeenCalledTimes(1);
  });
  it('does not trust mutable socket identity, forged rooms or stale authVersion', async () => {
    const fake = await socket('fake', B);
    fake.data.identity = { ...fake.data.identity!, userId: A };
    await broadcast.emitToUser(A, 'notifications:changed', {});
    expect(fake.emit).not.toHaveBeenCalled();
    const revoked = await socket('revoked', A);
    currentSocketAuthVersion.mockResolvedValue(1);
    await broadcast.emitToUser(A, 'notifications:changed', {});
    expect(revoked.emit).not.toHaveBeenCalled();
    expect(revoked.disconnect).toHaveBeenCalledWith(true);
  });
  it('fails closed on session lookup failure and rejects nonempty payloads', async () => {
    const a = await socket('a', A);
    currentSocketAuthVersion.mockRejectedValue(
      new Error('SQL password secret'),
    );
    const log = jest.spyOn(broadcast['logger'], 'error').mockImplementation();
    try {
      expect(await broadcast.emitToUser(A, 'notifications:changed', {})).toBe(
        false,
      );
      expect(a.emit).not.toHaveBeenCalled();
      expect(
        await broadcast.emitToUser(A, 'notifications:changed', {
          id: 'private',
        } as never),
      ).toBe(false);
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    } finally {
      log.mockRestore();
    }
  });
  it('isolates a broken tab and a throwing broadcaster after commit', async () => {
    const a = await socket('a', A),
      tab = await socket('tab', A);
    jest.mocked(a.emit).mockImplementation(() => {
      throw new Error('private');
    });
    const log = jest.spyOn(broadcast['logger'], 'error').mockImplementation();
    try {
      expect(await broadcast.emitToUser(A, 'notifications:changed', {})).toBe(
        false,
      );
      expect(tab.emit).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
    const publisher = new NotificationEventPublisher({
      emitToUser: async () => {
        throw new Error('private');
      },
    } as unknown as RealtimeBroadcastService);
    const error = jest.spyOn(publisher['logger'], 'error').mockImplementation();
    try {
      await expect(publisher.afterCommit([A, A])).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });
});
