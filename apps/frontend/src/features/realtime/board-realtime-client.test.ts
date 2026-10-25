import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import {
  asRealtimeSocket,
  FakeSocket,
  joined,
  refused,
  type SentRequest,
} from '../../test/fake-socket';
import { boardKeys } from '../boards/query-keys';
import { BoardRealtimeClient } from './board-realtime-client';
import {
  boardResyncTargets,
  invalidationTargets,
  type InvalidationTarget,
} from './event-invalidation';
import type { RealtimeSocket } from './socket-client';

const A = '11111111-1111-4111-8111-11111111111A';
const B = '22222222-2222-4222-8222-222222222222';

let socket: FakeSocket;
let createSocket: Mock<() => RealtimeSocket>;
let invalidate: Mock<(targets: InvalidationTarget[]) => void>;
let verifySession: Mock<() => void>;
let client: BoardRealtimeClient;

/** Lets queued watch changes apply (they wait for the current task to end). */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  socket = new FakeSocket();
  createSocket = vi.fn(() => asRealtimeSocket(socket));
  invalidate = vi.fn();
  verifySession = vi.fn();
  client = new BoardRealtimeClient({
    createSocket,
    invalidate,
    verifySession,
    ackTimeoutMs: 5_000,
    retryBaseMs: 1_000,
    maxRetries: 2,
    idleDisconnectMs: 10_000,
  });
});

afterEach(() => {
  client.dispose();
  vi.useRealTimers();
});

/** Watches `boardId`, connects and answers its join successfully. */
async function live(boardId: string) {
  const stop = client.watch(boardId);
  await settle();
  if (!socket.connected) socket.open();
  socket.lastJoin().reply(joined(boardId));
  invalidate.mockClear();
  return stop;
}

describe('BoardRealtimeClient connection', () => {
  it('opens no socket until a board is watched', async () => {
    await settle();
    expect(createSocket).not.toHaveBeenCalled();

    client.watch(A);
    await settle();

    expect(createSocket).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('joins once connected and resyncs the board after a successful ACK', async () => {
    client.watch(A);
    await settle();
    expect(socket.sent).toEqual([]);

    socket.open();
    const join = socket.lastJoin();
    expect(join).toMatchObject({ event: 'board:join', boardId: A });
    expect(join.timeoutMs).toBe(5_000);
    expect(client.status(A)).toBe('connecting');
    expect(invalidate).not.toHaveBeenCalled();

    join.reply(joined(A));

    expect(client.status(A)).toBe('live');
    expect(invalidate).toHaveBeenCalledWith(boardResyncTargets(A));
  });

  it.each<[string, (join: SentRequest) => void]>([
    ['an ACK for another board', (join) => join.reply(joined(B))],
    ['a timed-out ACK', (join) => join.timeOut()],
    ['TOO_MANY_REQUESTS', (join) => join.reply(refused('TOO_MANY_REQUESTS'))],
    ['INTERNAL_ERROR', (join) => join.reply(refused('INTERNAL_ERROR'))],
  ])(
    'is not live after %s and retries with backoff, then pauses',
    async (_, answer) => {
      client.watch(A);
      await settle();
      socket.open();

      answer(socket.lastJoin());
      expect(client.status(A)).toBe('connecting');
      expect(invalidate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(999);
      expect(socket.requests('board:join')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(socket.requests('board:join')).toHaveLength(2);

      answer(socket.lastJoin());
      await vi.advanceTimersByTimeAsync(1_999);
      expect(socket.requests('board:join')).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(socket.requests('board:join')).toHaveLength(3);

      answer(socket.lastJoin());
      expect(client.status(A)).toBe('paused');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(socket.requests('board:join')).toHaveLength(3);
    },
  );

  it('marks a refused board unavailable and lets REST re-check it, without retrying', async () => {
    client.watch(A);
    await settle();
    socket.open();

    socket.lastJoin().reply(refused('NOT_FOUND'));

    expect(client.status(A)).toBe('unavailable');
    expect(invalidate).toHaveBeenCalledWith([
      { queryKey: boardKeys.detail(A), exact: true },
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.requests('board:join')).toHaveLength(1);
  });

  it('re-checks the session on an UNAUTHORIZED ACK instead of retrying the join', async () => {
    client.watch(A);
    await settle();
    socket.open();

    socket.lastJoin().reply(refused('UNAUTHORIZED'));

    expect(verifySession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.requests('board:join')).toHaveLength(1);
  });
});

describe('BoardRealtimeClient board changes', () => {
  it('sends one join and no leave for a StrictMode mount → unmount → mount', async () => {
    const first = client.watch(A);
    first();
    client.watch(A);
    await settle();
    socket.open();

    expect(socket.requests('board:join')).toHaveLength(1);
    expect(socket.requests('board:leave')).toHaveLength(0);
  });

  it('sends no join/leave pairs for a StrictMode remount on a connected socket', async () => {
    await live(A);

    const first = client.watch(B);
    first();
    client.watch(B);
    await settle();

    expect(socket.requests('board:join').map((r) => r.boardId)).toEqual([A, B]);
    expect(socket.requests('board:leave')).toEqual([]);
  });

  it('leaves the old board and ignores its late ACK and events after switching', async () => {
    const stopA = client.watch(A);
    await settle();
    socket.open();
    const lateJoinA = socket.lastJoin();

    stopA();
    client.watch(B);
    await settle();
    expect(socket.requests('board:leave').map((r) => r.boardId)).toEqual([A]);

    lateJoinA.reply(joined(A));
    socket.push('card:updated', { boardId: A, cardId: 'c', columnId: 'x' });

    expect(client.status(A)).toBe('connecting');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('ignores a stale ACK of an earlier visit after A → B → A', async () => {
    const stopA = client.watch(A);
    await settle();
    socket.open();
    const firstJoinA = socket.lastJoin();
    stopA();
    const stopB = client.watch(B);
    await settle();
    stopB();
    client.watch(A);
    await settle();
    const secondJoinA = socket.lastJoin();
    expect(secondJoinA).not.toBe(firstJoinA);

    firstJoinA.reply(joined(A));
    expect(client.status(A)).toBe('connecting');

    secondJoinA.reply(joined(A));
    expect(client.status(A)).toBe('live');
  });

  it('closes the idle socket a while after the last board, unless one reopens', async () => {
    const stop = await live(A);
    stop();
    await settle();
    await vi.advanceTimersByTimeAsync(9_000);
    client.watch(B);
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.disconnect).not.toHaveBeenCalled();

    client.dispose();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('disconnects once no board has been watched for the idle period', async () => {
    const stop = await live(A);
    stop();
    await settle();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);

    client.watch(A);
    await settle();
    expect(socket.connect).toHaveBeenCalledTimes(2);
    expect(createSocket).toHaveBeenCalledTimes(1);
  });
});

describe('BoardRealtimeClient events', () => {
  it('invalidates for events of the live board, using the page board id', async () => {
    await live(A);
    const payload = { boardId: A.toLowerCase(), cardId: 'c1', columnId: 'x' };

    socket.push('card:updated', payload);

    expect(invalidate).toHaveBeenCalledWith(
      invalidationTargets('card:updated', { ...payload, boardId: A }),
    );
  });

  it.each(['comment:created', 'comment:updated', 'comment:deleted'] as const)(
    'routes %s to the matching Card comments',
    async (event) => {
      await live(A);
      const payload = {
        boardId: A.toLowerCase(),
        cardId: 'c1',
        commentId: 'm1',
      };
      socket.push(event, payload);
      socket.push(event, { ...payload, boardId: B });
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledWith(
        invalidationTargets(event, { ...payload, boardId: A }),
      );
    },
  );

  it('ignores events of other boards and malformed payloads', async () => {
    await live(A);

    socket.push('card:updated', { boardId: B, cardId: 'c', columnId: 'x' });
    socket.push('column:created', null);
    socket.push('column:created', { columnId: 'x' });
    socket.push('column:created', 'oops');

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('ignores events that arrive before the join ACK', async () => {
    client.watch(A);
    await settle();
    socket.open();

    socket.push('column:created', { boardId: A, columnId: 'x' });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('listens to each of the 17 business events exactly once', async () => {
    client.watch(A);
    client.watch(B);
    await settle();

    expect(socket.listenerCount('card:moved')).toBe(1);
    expect(socket.listenerCount('member:removed')).toBe(1);
    expect(socket.listenerCount('comment:created')).toBe(1);
    expect(socket.listenerCount('comment:updated')).toBe(1);
    expect(socket.listenerCount('comment:deleted')).toBe(1);
    expect(socket.listenerCount('board:archived')).toBe(1);
    expect(socket.listenerCount('board:restored')).toBe(1);
  });
});

describe('BoardRealtimeClient reconnection', () => {
  it('rejoins and resyncs after the network comes back, even without new events', async () => {
    await live(A);

    socket.drop();
    expect(client.status(A)).toBe('reconnecting');
    socket.push('card:created', { boardId: A, cardId: 'c', columnId: 'x' });
    expect(invalidate).not.toHaveBeenCalled();

    socket.open();
    expect(socket.requests('board:join')).toHaveLength(2);
    socket.lastJoin().reply(joined(A));

    expect(client.status(A)).toBe('live');
    expect(invalidate).toHaveBeenCalledWith(boardResyncTargets(A));
  });

  it('drops an ACK sent on the previous connection', async () => {
    client.watch(A);
    await settle();
    socket.open();
    const oldJoin = socket.lastJoin();

    socket.drop();
    oldJoin.reply(joined(A));

    expect(client.status(A)).toBe('connecting');
  });

  it('re-checks the session and reconnects with backoff after the server closes the socket', async () => {
    await live(A);

    socket.serverDisconnect();

    expect(verifySession).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.connect).toHaveBeenCalledTimes(2);
  });

  it('gives up after repeated handshake refusals and resumes on wake', async () => {
    client.watch(A);
    await settle();

    socket.refuse();
    await vi.advanceTimersByTimeAsync(1_000);
    socket.refuse();
    await vi.advanceTimersByTimeAsync(2_000);
    socket.refuse();

    expect(verifySession).toHaveBeenCalledTimes(3);
    expect(socket.connect).toHaveBeenCalledTimes(3);
    expect(client.status(A)).toBe('paused');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.connect).toHaveBeenCalledTimes(3);

    client.wake();
    expect(socket.connect).toHaveBeenCalledTimes(4);
  });

  it('leaves network errors to Socket.IO retries', async () => {
    client.watch(A);
    await settle();
    socket.active = true;

    socket.push('connect_error', new Error('xhr poll error'));

    expect(verifySession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('rejoins a paused board on wake', async () => {
    client.watch(A);
    await settle();
    socket.open();
    for (let i = 0; i < 3; i++) {
      socket.lastJoin().timeOut();
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(client.status(A)).toBe('paused');

    client.wake();
    socket.lastJoin().reply(joined(A));

    expect(socket.requests('board:join')).toHaveLength(4);
    expect(client.status(A)).toBe('live');
  });
});

describe('BoardRealtimeClient dispose', () => {
  it('disconnects, stops listening and ignores late ACKs', async () => {
    client.watch(A);
    await settle();
    socket.open();
    const join = socket.lastJoin();
    const listener = vi.fn();
    client.subscribe(listener);

    client.dispose();
    // Subscribers see the cleared private snapshot once; late work stays silent.
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    join.reply(joined(A));
    socket.push('column:created', { boardId: A, columnId: 'x' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.listenerCount('connect')).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('opens nothing for watches after dispose', async () => {
    client.dispose();
    client.watch(A);
    await settle();

    expect(createSocket).not.toHaveBeenCalled();
  });
});
