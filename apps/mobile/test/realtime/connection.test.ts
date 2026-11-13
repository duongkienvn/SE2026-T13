import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConnection } from '../../src/infrastructure/realtime/connection.ts';
import { decodeSessionUser } from '../../src/infrastructure/auth/session-api.ts';
import { setup } from '../query/support.ts';
import { flush, loginResponse, USER_B } from '../auth/support.ts';
import { FakeSocket } from './support.ts';

async function context() {
  const base = await setup();
  const sockets: FakeSocket[] = [];
  let connected = 0;
  let ends = 0;
  const connection = createConnection({
    manager: base.manager,
    timers: base.time,
    createSocket: (credential) => {
      const socket = new FakeSocket(credential);
      sockets.push(socket);
      return socket;
    },
    verify: (identity, signal) =>
      base.layer.api.json('/users/me', decodeSessionUser, {
        identity,
        signal,
        retries: 0,
      }),
    connected: () => {
      connected++;
    },
    lost() {},
    sessionEnded: () => {
      ends++;
    },
    receive() {},
  });
  return {
    ...base,
    connection,
    sockets,
    get connected() {
      return connected;
    },
    get ends() {
      return ends;
    },
    dispose() {
      connection.dispose();
      base.dispose();
    },
  };
}
test('only verified foreground online sessions connect once; reconnect obtains current credentials and verifies REST first', async () => {
  const c = await context();
  try {
    c.connection.start();
    assert.equal(c.sockets.length, 0);
    c.connection.setEnvironment({ foreground: true, online: true });
    assert.equal(c.sockets.length, 1);
    const first = c.sockets[0]!;
    first.server('connect');
    c.connection.start();
    c.connection.setEnvironment({ foreground: true, online: true });
    assert.equal(c.sockets.length, 1);
    first.server('disconnect');
    assert.equal(first.listeners.size, 0);
    c.time.advance(500);
    await flush();
    assert.equal(c.requests.length, 1);
    assert.equal(c.sockets.length, 2);
    const second = c.sockets[1]!;
    assert.equal(second.lastToken, first.lastToken);
    second.server('connect');
    assert.equal(c.connected, 2);
    c.connection.setEnvironment({ foreground: false, online: true });
    assert.equal(second.listeners.size, 0);
    c.connection.setEnvironment({ foreground: true, online: false });
    assert.equal(c.sockets.length, 2);
    c.connection.setEnvironment({ foreground: true, online: true });
    await flush();
    assert.equal(c.sockets.length, 3);
  } finally {
    c.dispose();
  }
  assert.equal(c.time.timerCount, 0);
});
test('late callbacks and auth failures cannot terminate a switched account', async () => {
  const c = await context();
  try {
    c.connection.setEnvironment({ foreground: true, online: true });
    c.connection.start();
    const old = c.sockets[0]!;
    const late = old.listeners.get('connect_error')![0]!;
    await c.manager.establishSession(loginResponse(USER_B));
    assert.equal(old.listeners.size, 0);
    assert.equal(c.sockets.length, 2);
    late({ data: { code: 'UNAUTHORIZED' } });
    assert.equal(c.layer.getIdentity()?.userId, USER_B);
    assert.equal(c.sockets[1]!.lastToken, loginResponse(USER_B).accessToken);
    c.sockets[1]!.server('connect_error', { data: { code: 'UNAUTHORIZED' } });
    assert.equal(c.manager.getSnapshot().status, 'unauthenticated');
    assert.equal(c.sockets[1]!.listeners.size, 0);
  } finally {
    c.dispose();
  }
});
test('connection failures have a bounded retry budget and disposal clears timers/listeners', async () => {
  const c = await context();
  c.connection.setEnvironment({ foreground: true, online: true });
  c.connection.start();
  for (const delay of [500, 1000, 2000, 4000]) {
    c.sockets
      .at(-1)!
      .server('connect_error', new Error('private native error'));
    c.time.advance(delay);
    await flush();
  }
  c.sockets.at(-1)!.server('connect_error');
  c.time.advance(30_000);
  await flush();
  assert.equal(c.sockets.length, 5);
  assert.equal(c.connection.getSnapshot(), 'paused');
  c.dispose();
  assert.equal(c.time.timerCount, 0);
  assert.ok(c.sockets.every((socket) => socket.listeners.size === 0));
});
