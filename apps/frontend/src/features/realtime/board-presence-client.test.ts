import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import type { InvalidationTarget } from './event-invalidation';
import {
  asRealtimeSocket,
  FakeSocket,
  joined,
  refused,
} from '../../test/fake-socket';
import { BoardRealtimeClient } from './board-realtime-client';

const A = '11111111-1111-4111-8111-11111111111a';
const B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
let socket: FakeSocket;
let client: BoardRealtimeClient;
let invalidate: Mock<(targets: InvalidationTarget[]) => void>;
const settle = () => vi.advanceTimersByTimeAsync(0);
const push = (userIds: string[], boardId = A) =>
  socket.push('presence:sync', { boardId, userIds });
beforeEach(() => {
  vi.useFakeTimers();
  socket = new FakeSocket();
  invalidate = vi.fn();
  client = new BoardRealtimeClient({
    createSocket: () => asRealtimeSocket(socket),
    invalidate,
    verifySession: vi.fn(),
    retryBaseMs: 100,
    maxRetries: 1,
  });
});
afterEach(() => {
  client.dispose();
  vi.useRealTimers();
});
const start = async () => {
  client.watch(A);
  await settle();
  socket.open();
};

describe('authoritative presence and join acknowledgment', () => {
  it('installs a single listener before joining and applies an initial snapshot received before ACK', async () => {
    await start();
    expect(socket.listenerCount('presence:sync')).toBe(1);
    push([USER]);
    expect(client.presence(A)).toEqual({ status: 'syncing', userIds: null });
    socket.lastJoin().reply(joined(A));
    expect(client.presence(A)).toEqual({ status: 'live', userIds: [USER] });
  });
  it('uses the latest buffered snapshot then replaces it with every subsequent full snapshot', async () => {
    await start();
    push([USER]);
    push([USER, B]);
    push([B]);
    socket.lastJoin().reply(joined(A));
    expect(client.presence(A).userIds).toEqual([B]);
    invalidate.mockClear();
    push([]);
    expect(client.presence(A)).toEqual({ status: 'live', userIds: [] });
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('waits for a snapshot after ACK and preserves snapshot identity for equivalent populations', async () => {
    await start();
    socket.lastJoin().reply(joined(A));
    expect(client.presence(A)).toEqual({ status: 'syncing', userIds: null });
    push([USER, B, USER]);
    const snapshot = client.presence(A);
    const listener = vi.fn();
    client.subscribe(listener);
    push([B, USER]);
    expect(client.presence(A)).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
  });
  it.each(['NOT_FOUND', 'VALIDATION_FAILED'] as const)(
    'discards pending data when join fails with %s',
    async (code) => {
      await start();
      push([USER]);
      socket.lastJoin().reply(refused(code));
      push([B]);
      expect(client.presence(A)).toEqual({
        status: 'unavailable',
        userIds: null,
      });
    },
  );
  it('drops buffered snapshots and late ACKs after timeout, then retries with fresh state', async () => {
    await start();
    const old = socket.lastJoin();
    push([USER]);
    old.timeOut();
    push([USER]);
    old.reply(joined(A));
    expect(client.presence(A).userIds).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    push([B]);
    socket.lastJoin().reply(joined(A));
    old.reply(joined(A));
    expect(client.presence(A).userIds).toEqual([B]);
  });
  it('isolates boards and ignores invalid, unwatched and malformed input', async () => {
    await start();
    client.watch(B);
    await settle();
    for (const join of socket.requests('board:join'))
      join.reply(joined(join.boardId));
    push([USER], B);
    push([B]);
    const snapshot = client.presence(A);
    socket.push('presence:sync', { boardId: A, userIds: ['private'] });
    socket.push('presence:sync', { boardId: USER, userIds: [USER] });
    expect(client.presence(A)).toBe(snapshot);
    expect(client.presence(A).userIds).toEqual([B]);
    expect(client.presence(B).userIds).toEqual([USER]);
  });
});

describe('presence connection and observer cleanup', () => {
  it('rejects queued events and ACKs from the previous connection epoch', async () => {
    await start();
    push([USER]);
    const oldJoin = socket.lastJoin();
    const [oldEvent] = socket.capture('presence:sync');
    oldJoin.reply(joined(A));
    socket.drop();
    expect(client.presence(A)).toEqual({
      status: 'reconnecting',
      userIds: null,
    });
    push([USER]);
    socket.open();
    oldEvent({ boardId: A, userIds: [USER] });
    oldJoin.reply(joined(A));
    socket.lastJoin().reply(joined(A));
    expect(client.presence(A).userIds).toBeNull();
    push([B]);
    oldEvent({ boardId: A, userIds: [USER] });
    expect(client.presence(A).userIds).toEqual([B]);
    expect(socket.listenerCount('presence:sync')).toBe(1);
  });
  it('keeps one room for multiple watchers, then masks and removes its state after the last unwatch', async () => {
    const first = client.watch(A),
      second = client.watch(A);
    await settle();
    socket.open();
    push([USER]);
    socket.lastJoin().reply(joined(A));
    first();
    await settle();
    expect(client.presence(A).userIds).toEqual([USER]);
    second();
    expect(client.presence(A).userIds).toBeNull();
    await settle();
    expect(socket.requests('board:leave')).toHaveLength(1);
    client.watch(A);
    await settle();
    socket.lastJoin().reply(joined(A));
    expect(client.presence(A).userIds).toBeNull();
  });
  it('clears buffers when unwatching during join and ignores stale replies after switching back', async () => {
    const stop = client.watch(A);
    await settle();
    socket.open();
    const old = socket.lastJoin();
    push([USER]);
    stop();
    client.watch(B);
    await settle();
    client.watch(A);
    await settle();
    old.reply(joined(A));
    socket.lastJoin().reply(joined(A));
    expect(client.presence(A).userIds).toBeNull();
    expect(client.presence(B).userIds).toBeNull();
  });
  it('clears private state on dispose and refuses new watches or captured deliveries', async () => {
    await start();
    push([USER]);
    socket.lastJoin().reply(joined(A));
    const [late] = socket.capture('presence:sync');
    const listener = vi.fn();
    client.subscribe(listener);
    client.dispose();
    expect(listener).toHaveBeenCalled();
    late({ boardId: A, userIds: [USER] });
    client.watch(A);
    await settle();
    expect(client.presence(A).userIds).toBeNull();
    expect(socket.listenerCount('presence:sync')).toBe(0);
    expect(socket.requests('board:join')).toHaveLength(1);
  });
  it('does not restore a timed-out buffer after retries pause or wake', async () => {
    await start();
    push([USER]);
    socket.lastJoin().timeOut();
    await vi.advanceTimersByTimeAsync(100);
    push([B]);
    socket.lastJoin().timeOut();
    expect(client.presence(A)).toEqual({ status: 'paused', userIds: null });
    client.wake();
    socket.lastJoin().reply(joined(A));
    expect(client.presence(A)).toEqual({ status: 'syncing', userIds: null });
  });
});
