import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  BOARD,
  CARD,
  integration,
  ok,
  payload,
} from './integration-support.ts';
import { deferred, flush } from '../auth/support.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';

test('duplicate/malformed events have bounded actual HTTP counts; same-user other-device updates are retained', async () => {
  const c = await integration();
  try {
    await c.join();
    c.observe(c.cardKey);
    const initial = c.requests.length;
    c.socket.server('card:updated', { ...payload, cardId: 'invalid' });
    c.time.advance(50);
    await flush();
    assert.equal(c.requests.length, initial);
    c.configure({ cardValue: 2 });
    for (let i = 0; i < 20; i++) c.socket.server('card:updated', payload);
    c.time.advance(50);
    await flush();
    assert.equal(c.requests.length, initial + 1);
    assert.equal(c.data.queryClient.getQueryData(c.cardKey), 2);
    c.configure({ cardValue: 3 });
    c.socket.server('card:updated', payload);
    c.time.advance(50);
    await flush();
    assert.equal(c.requests.length, initial + 2);
    assert.equal(c.data.queryClient.getQueryData(c.cardKey), 3);
    const attachments = queryKeys.attachments(c.identity, BOARD, CARD);
    c.observe(attachments, 'attachments');
    const after = c.requests.length;
    c.socket.server('card:updated', { ...payload, changeScope: 'attachments' });
    c.time.advance(50);
    await flush();
    assert.equal(
      c.requests.length,
      after + 1,
      'an attachment hint does not refetch the main Card',
    );
  } finally {
    c.dispose();
  }
});
test('socket echoes during an optimistic write share its authoritative refresh and never reset its draft early', async () => {
  const c = await integration();
  try {
    await c.join();
    c.observe(c.cardKey);
    const key = c.cardKey;
    const identity = c.identity;
    const commit = deferred<Response>();
    c.respond((_url, init) =>
      init.method === 'PATCH' ? commit.promise : null,
    );
    const before = c.requests.length;
    const write = c.data.optimistic({
      identity,
      key,
      update: () => 8,
      mutation: () =>
        c.data.api.json(`/boards/${BOARD}/cards/${CARD}`, (value) => value, {
          method: 'PATCH',
          body: { title: 'edited' },
          identity,
          resourceKey: key,
        }),
    });
    await flush();
    c.socket.server('card:updated', payload);
    c.time.advance(50);
    await flush();
    assert.equal(c.requests.length, before + 1);
    assert.equal(c.data.queryClient.getQueryData(key), 8);
    c.configure({ cardValue: 9 });
    commit.resolve(ok(9));
    await write;
    await flush();
    assert.equal(
      c.requests.length,
      before + 2,
      'one PATCH plus one authoritative GET',
    );
    assert.equal(c.data.queryClient.getQueryData(key), 9);
  } finally {
    c.dispose();
  }
});

test('label catalog changes refresh embedded labels and previews; Card edits also refresh Home up-next', async () => {
  const c = await integration();
  try {
    await c.join();
    const keys = [
      c.cardKey,
      queryKeys.cards(c.identity, BOARD),
      queryKeys.cardPreview(c.identity, BOARD, CARD),
      queryKeys.labels(c.identity, BOARD),
      queryKeys.tasks(c.identity),
      queryKeys.home(c.identity),
    ];
    keys.forEach((key, index) => c.observe(key, `read-${index}`));
    const other = queryKeys.card(c.identity, CARD, BOARD);
    c.observe(other, 'other-board');
    const before = c.requests.length;
    c.configure({ cardValue: 4 });
    c.socket.server('labels:changed', { boardId: BOARD, labelId: CARD });
    c.time.advance(50);
    await flush();
    assert.equal(c.requests.length, before + keys.length);
    keys.forEach((key) =>
      assert.equal(c.data.queryClient.getQueryData(key), 4),
    );
    assert.equal(c.data.queryClient.getQueryData(other), 0);
    c.configure({ cardValue: 5 });
    c.socket.server('card:updated', payload);
    c.time.advance(50);
    await flush();
    assert.equal(c.requests.length, before + keys.length + 5);
    assert.equal(
      c.data.queryClient.getQueryData(queryKeys.home(c.identity)),
      5,
    );
  } finally {
    c.dispose();
  }
});
test('background/offline cleanup suspends presence and resumes only after session verification and fresh room authorization', async () => {
  const c = await integration();
  try {
    await c.join();
    c.socket.server('presence:sync', {
      boardId: BOARD,
      userIds: [c.identity.userId],
    });
    assert.equal(c.realtime.getBoardSnapshot(BOARD).userIds.length, 1);
    const old = c.socket;
    c.environment(false, false);
    assert.equal(old.listeners.size, 0);
    assert.equal(c.realtime.getBoardSnapshot(BOARD).userIds.length, 0);
    c.environment(true, false);
    assert.equal(c.sockets.length, 1);
    const count = c.requests.length;
    c.environment(true, true);
    await flush();
    assert.equal(
      c.requests.length,
      count + 1,
      'reconnect verifies /users/me before socket creation',
    );
    c.socket.server('connect');
    await flush();
    assert.equal(
      c.requests.length,
      count + 2,
      'Board read grants are independently checked',
    );
    c.socket.ack(
      c.socket.commands.findLastIndex(
        (command) => command.event === 'board:join',
      ),
    );
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'live');
  } finally {
    c.dispose();
  }
  assert.equal(c.time.timerCount, 0);
});
test('notification hints are session-level, join timeouts/late ACKs cannot duplicate recovery, and disposal removes listeners', async () => {
  const c = await integration();
  try {
    c.socket.server('connect');
    const notifications = queryKeys.notificationList(c.identity);
    c.observe(notifications, 'notifications');
    const before = c.requests.length;
    c.socket.server('notifications:changed', {});
    c.socket.server('notifications:changed', {});
    c.time.advance(50);
    await flush();
    assert.equal(c.requests.length, before + 1);
    const stop = c.realtime.watchBoard(BOARD);
    await flush();
    const first = c.socket.commands.findLastIndex(
      (command) => command.event === 'board:join',
    );
    c.time.advance(5000);
    c.socket.ack(first);
    assert.notEqual(c.realtime.getBoardSnapshot(BOARD).status, 'live');
    c.time.advance(250);
    const second = c.socket.commands.findLastIndex(
      (command) => command.event === 'board:join',
    );
    c.socket.ack(second);
    c.socket.ack(second);
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'live');
    stop();
  } finally {
    c.dispose();
  }
  assert.equal(c.time.timerCount, 0);
  assert.ok(c.sockets.every((socket) => socket.listeners.size === 0));
});
test('expiry, logout and malformed/temporary failures never create a private-state or credential log', async () => {
  const captures: unknown[][] = [];
  const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(
    (method) =>
      mock.method(console, method, (...args: unknown[]) => {
        captures.push(args);
      }),
  );
  const c = await integration();
  try {
    await c.join();
    c.socket.server('card:updated', { token: 'private', boardId: BOARD });
    c.socket.server('presence:sync', { boardId: BOARD, userIds: ['invalid'] });
    c.time.advance(3600_000);
    await flush();
    assert.equal(c.manager.getSnapshot().status, 'expired');
    assert.equal(c.socket.listeners.size, 0);
    assert.deepEqual(captures, []);
  } finally {
    c.dispose();
    spies.forEach((spy) => spy.mock.restore());
  }
});

test('logout immediately cancels the realtime session, pending hints and all protected subscriptions', async () => {
  const c = await integration();
  try {
    await c.join();
    c.observe(c.cardKey);
    const key = c.cardKey;
    const socket = c.socket;
    socket.server('card:updated', payload);
    const before = c.requests.length;
    await c.manager.logout();
    c.time.advance(10_000);
    await flush();
    assert.equal(socket.listeners.size, 0);
    assert.equal(c.data.queryClient.getQueryData(key), undefined);
    assert.equal(c.realtime.getBoardSnapshot(BOARD).userIds.length, 0);
    assert.equal(c.requests.length, before);
  } finally {
    c.dispose();
  }
});
