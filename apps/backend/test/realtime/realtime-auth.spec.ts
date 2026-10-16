import { AuthService } from '../../src/api/auth/auth.service';
import { RealtimeAuthService } from '../../src/realtime/realtime-auth.service';
import type { RealtimeSocket } from '../../src/realtime/realtime.types';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('RealtimeAuthService', () => {
  const authenticateAccessToken = jest.fn();
  let service: RealtimeAuthService;
  let socket: RealtimeSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new RealtimeAuthService({
      authenticateAccessToken,
    } as unknown as AuthService);
    socket = {
      id: 'socket',
      connected: true,
      data: {},
      handshake: { auth: { accessToken: 'credential', userId: 'forged' } },
      disconnect: jest.fn(),
    } as unknown as RealtimeSocket;
    authenticateAccessToken.mockReset();
  });
  afterEach(() => {
    service.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('uses verified identity and disconnects at expiration, clearing the credential', async () => {
    authenticateAccessToken.mockResolvedValue({
      userId: 'verified',
      expiresAt: Date.now() + 1000,
    });
    await service.authenticate(socket);
    expect(socket.data.identity?.userId).toBe('verified');
    expect(socket.handshake.auth).not.toHaveProperty('accessToken');
    service.connected(socket);
    jest.advanceTimersByTime(999);
    expect(socket.disconnect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([undefined, '', null, 42])(
    'rejects malformed handshake token %s',
    async (token) => {
      socket.handshake.auth.accessToken = token;
      await expect(service.authenticate(socket)).rejects.toMatchObject({
        message: 'Unauthorized',
        data: { code: 'UNAUTHORIZED' },
      });
      expect(authenticateAccessToken).not.toHaveBeenCalled();
    },
  );

  it('sanitizes authentication failures', async () => {
    authenticateAccessToken.mockRejectedValue(
      new Error('credential and SQL must not escape'),
    );
    await expect(service.authenticate(socket)).rejects.toThrow('Unauthorized');
    expect(socket.handshake.auth).not.toHaveProperty('accessToken');
  });

  it('rejects tokens expiring during user lookup and rechecks time independently of timers', async () => {
    authenticateAccessToken.mockResolvedValue({
      userId: 'verified',
      expiresAt: Date.now(),
    });
    await expect(service.authenticate(socket)).rejects.toThrow('Unauthorized');
    expect(service.isActive(socket)).toBe(false);
  });

  it('cleans timers on disconnect and shutdown and handles long expiration', async () => {
    authenticateAccessToken.mockResolvedValue({
      userId: 'verified',
      expiresAt: Date.now() + 3_000_000_000,
    });
    await service.authenticate(socket);
    service.connected(socket);
    jest.advanceTimersByTime(2_147_483_647);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
    service.cleanup(socket);
    expect(jest.getTimerCount()).toBe(0);
    service.connected(socket);
    service.onApplicationShutdown();
    expect(jest.getTimerCount()).toBe(0);
  });
});
