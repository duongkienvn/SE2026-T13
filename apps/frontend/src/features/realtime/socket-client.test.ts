import type { ManagerOptions, SocketOptions } from 'socket.io-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRealtimeSocket, socketOrigin } from './socket-client';

const io = vi.hoisted(() => vi.fn());
vi.mock('socket.io-client', () => ({ io }));
// `setup.ts` fakes this module for every other test.
vi.unmock('./socket-client');

type Options = Partial<ManagerOptions & SocketOptions>;
type AuthCallback = (send: (data: object) => void) => void;

const fakeSocket = { disconnect: vi.fn() };

beforeEach(() => {
  io.mockReset().mockReturnValue(fakeSocket);
  fakeSocket.disconnect.mockReset();
});

function created(): { url: string; options: Options; auth: AuthCallback } {
  const [url, options] = io.mock.calls[0] as [string, Options];
  return { url, options, auth: options.auth as AuthCallback };
}

describe('socketOrigin', () => {
  it('drops the REST /api prefix', () => {
    expect(socketOrigin('http://localhost:3000/api')).toBe(
      'http://localhost:3000',
    );
    expect(socketOrigin('https://kanban.example.com:8443/v1/api')).toBe(
      'https://kanban.example.com:8443',
    );
  });

  it("uses the page's origin for a relative API URL", () => {
    expect(socketOrigin('/api', 'http://localhost:5173')).toBe(
      'http://localhost:5173',
    );
  });
});

describe('createRealtimeSocket', () => {
  it('targets /socket.io on the backend origin and waits for connect()', () => {
    createRealtimeSocket(() => Promise.resolve('token'));

    const { url, options } = created();
    expect(url).toBe('http://localhost:3000');
    expect(url).not.toContain('/api');
    expect(options.path).toBe('/socket.io');
    expect(options.autoConnect).toBe(false);
    expect(options.query).toBeUndefined();
  });

  it('sends a freshly read token in the handshake auth on every connection', async () => {
    const tokens = ['first', 'second'];
    createRealtimeSocket(() => Promise.resolve(tokens.shift()!));
    const { auth } = created();

    const send = vi.fn();
    auth(send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    auth(send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    expect(send.mock.calls).toEqual([
      [{ accessToken: 'first' }],
      [{ accessToken: 'second' }],
    ]);
  });

  it('stops instead of connecting when the session has ended', async () => {
    createRealtimeSocket(() => Promise.reject(new Error('Session ended')));
    const { auth } = created();

    const send = vi.fn();
    auth(send);

    await vi.waitFor(() => expect(fakeSocket.disconnect).toHaveBeenCalled());
    expect(send).not.toHaveBeenCalled();
  });
});
