import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';

const require = createRequire(import.meta.url);
// Reuse the existing workspace client, without adding a backend dependency.
const { io } = createRequire(
  new URL('../../frontend/package.json', import.meta.url),
)('socket.io-client');
const { JwtService } = require('@nestjs/jwt');
const {
  BoardRoomCoordinator,
} = require('../src/realtime/board-room-coordinator.service.ts');
const {
  RealtimeBroadcastService,
} = require('../src/realtime/realtime-broadcast.service.ts');
const {
  JWT_AUDIENCE,
  JWT_ISSUER,
} = require('../src/api/auth/constants/auth.constants.ts');
const request = require('supertest');

export const ids = {
  owner: '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  member: '2c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  other: '3c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  absent: '4c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  a: 'c6ba7134-97ef-4c1b-a342-001a982a7721',
  b: 'd6ba7134-97ef-4c1b-a342-001a982a7721',
  archived: 'e6ba7134-97ef-4c1b-a342-001a982a7721',
  empty: 'f6ba7134-97ef-4c1b-a342-001a982a7721',
};

export function configureTestEnvironment() {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
    API_PREFIX: 'api',
    SWAGGER_ENABLED: 'false',
    CORS_ORIGINS: 'https://kanban.test',
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nextEvent(socket, event, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const done = (...args) => {
      clearTimeout(timer);
      resolve(args);
    };
    const timer = setTimeout(() => {
      socket.off(event, done);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    socket.once(event, done);
  });
}

export async function runRealtimeChecks(app, source) {
  const base = await app.getUrl();
  const jwt = app.get(JwtService);
  const coordinator = app.get(BoardRoomCoordinator);
  const broadcast = app.get(RealtimeBroadcastService);
  const clients = [];
  const tokens = {};
  const passed = [];
  const check = (name) => {
    passed.push(name);
    console.log(`PASS: ${name}`);
  };
  const room = (boardId) => `board:${boardId}`;
  const makeClient = (accessToken, options = {}) => {
    const socket = io(base, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      timeout: 2000,
      transports: ['websocket'],
      auth: { accessToken },
      ...options,
    });
    clients.push(socket);
    return socket;
  };
  const connect = async (token, options) => {
    const socket = makeClient(token, options);
    const connected = nextEvent(socket, 'connect');
    socket.connect();
    await connected;
    return socket;
  };
  const rejectToken = async (token, options) => {
    const socket = makeClient(token, options);
    const rejected = nextEvent(socket, 'connect_error');
    socket.connect();
    const [error] = await rejected;
    assert.equal(socket.connected, false);
    socket.close();
    return error;
  };
  const ack = (socket, event, payload) =>
    socket.timeout(3000).emitWithAck(event, payload);
  const join = async (socket, boardId) => {
    assert.deepEqual(await ack(socket, 'board:join', { boardId }), {
      success: true,
      boardId: boardId.toLowerCase(),
    });
  };
  // An acknowledged packet after a broadcast is an ordered delivery barrier on
  // each transport. Negative assertions do not rely on arbitrary sleep windows.
  const flush = async (sockets) => {
    await Promise.all(
      sockets
        .filter((s) => s.connected)
        .map((s) => ack(s, 'board:leave', { boardId: ids.empty })),
    );
  };

  try {
    for (const user of ['owner', 'member', 'other']) {
      const result = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: `${user}@realtime.test`,
          password: 'realtime-test-password',
        })
        .expect(200);
      tokens[user] = result.body.data.accessToken;
    }
    const owner = await connect(tokens.owner, {
      auth: { accessToken: tokens.owner, userId: ids.other, role: 'OWNER' },
    });
    const member = await connect(tokens.member);
    const memberTab = await connect(tokens.member);
    const other = await connect(tokens.other);
    const unauthorized = await connect(tokens.other);
    check('REST login -> authenticated socket; client identity is ignored');

    const forged = new JwtService({ secret: randomBytes(32).toString('hex') });
    const invalidTokens = [
      undefined,
      '',
      17,
      'invalid',
      `${tokens.owner}tampered`,
      await forged.signAsync(
        { sub: ids.owner },
        { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 60 },
      ),
      await jwt.signAsync({ sub: ids.owner }, { expiresIn: -1 }),
      await jwt.signAsync({ sub: ids.absent }),
      await jwt.signAsync({ sub: ids.owner }, { issuer: 'wrong-issuer' }),
      await jwt.signAsync({ sub: ids.owner }, { audience: 'wrong-audience' }),
      await jwt.signAsync({ sub: ids.owner }, { algorithm: 'HS384' }),
    ];
    for (const token of invalidTokens) {
      const error = await rejectToken(token);
      assert.equal(error.message, 'Unauthorized');
      assert.deepEqual(error.data, { code: 'UNAUTHORIZED' });
    }
    check(
      'missing/invalid/forged/expired JWT, issuer/audience/algorithm and absent user rejected',
    );

    await connect(tokens.owner, {
      transports: ['polling'],
      extraHeaders: { Origin: 'https://kanban.test' },
    });
    await rejectToken(tokens.owner, {
      extraHeaders: { Origin: 'https://untrusted.test' },
    });
    await rejectToken(tokens.owner, {
      transports: ['polling'],
      extraHeaders: { Origin: 'https://untrusted.test' },
    });
    check('origin allow-list enforced for polling and WebSocket transports');

    await join(owner, ids.a);
    await join(member, ids.a.toUpperCase());
    await join(memberTab, ids.a);
    await join(other, ids.b);
    await join(owner, ids.a);
    await join(member, ids.archived);
    check('OWNER/MEMBER, archived board and duplicate joins');

    for (const boardId of [ids.a, ids.archived, ids.empty]) {
      const denied = await ack(unauthorized, 'board:join', { boardId });
      assert.deepEqual(denied, {
        success: false,
        code: 'NOT_FOUND',
        message: 'Board not found',
      });
    }
    for (const payload of [
      null,
      [],
      {},
      { boardId: 'bad' },
      { boardId: ids.a, userId: ids.owner },
      { boardId: ids.a, room: room(ids.a) },
    ]) {
      assert.equal(
        (await ack(unauthorized, 'board:join', payload)).code,
        'VALIDATION_FAILED',
      );
    }
    assert.equal(
      (await ack(owner, 'board:join', { boardId: ids.b })).code,
      'NOT_FOUND',
    );
    check(
      'cross-board/private board rejection; UUID validation and spoofed fields',
    );

    const received = new Map(
      [owner, member, memberTab, other, unauthorized].map((s) => [s, []]),
    );
    for (const [socket, values] of received)
      socket.on('test:board', (payload) => values.push(payload.sequence));
    assert.equal(
      await broadcast.emitToBoard(ids.a, 'test:board', { sequence: 1 }),
      true,
    );
    await flush([...received.keys()]);
    assert.deepEqual([...received.values()], [[1], [1], [1], [], []]);
    assert.equal(
      await broadcast.emitToBoard(ids.empty, 'test:board', { sequence: 99 }),
      true,
    );
    check(
      'same-board delivery, cross-board/non-member isolation and no-subscriber safety',
    );

    await join(member, ids.b);
    await ack(member, 'board:leave', { boardId: ids.a });
    await ack(member, 'board:leave', { boardId: ids.a });
    await broadcast.emitToBoard(ids.a, 'test:board', { sequence: 2 });
    await broadcast.emitToBoard(ids.b, 'test:board', { sequence: 3 });
    await flush([...received.keys()]);
    assert.deepEqual(received.get(member), [1, 3]);
    check('multiple boards; repeated leave only affects its own room');
    await join(member, ids.a);

    // Exercise real transport reconnection, including a new handshake.
    const oldId = owner.id;
    owner.io.reconnection(true);
    owner.io.reconnectionDelay(10);
    const reconnected = nextEvent(owner, 'connect');
    coordinator.server.sockets.sockets.get(oldId).conn.close();
    await reconnected;
    assert.notEqual(owner.id, oldId);
    assert.equal(coordinator.server.sockets.sockets.has(oldId), false);
    assert.equal(
      coordinator.server.sockets.sockets.get(owner.id).rooms.has(room(ids.a)),
      false,
    );
    await join(owner, ids.a);
    owner.auth = { accessToken: 'invalid-on-reconnect' };
    const reauthFailure = nextEvent(owner, 'connect_error');
    coordinator.server.sockets.sockets.get(owner.id).conn.close();
    assert.equal((await reauthFailure)[0].data.code, 'UNAUTHORIZED');
    owner.io.reconnection(false);
    owner.auth = { accessToken: tokens.owner };
    const connectedAgain = nextEvent(owner, 'connect');
    owner.connect();
    await connectedAgain;
    await join(owner, ids.a);
    check(
      'transport reconnect authenticates again and never restores stale rooms',
    );

    const shortToken = await jwt.signAsync(
      { sub: ids.member },
      { expiresIn: 2 },
    );
    const expiring = await connect(shortToken);
    await join(expiring, ids.a);
    const expired = nextEvent(expiring, 'disconnect');
    await expired;
    assert.equal((await rejectToken(shortToken)).data.code, 'UNAUTHORIZED');
    check(
      'long-lived socket disconnects at JWT expiration; expired reconnect rejected',
    );

    const delayed = await connect(tokens.member);
    await join(delayed, ids.a);
    const delayedValues = [];
    delayed.on('test:board', (value) => delayedValues.push(value));
    coordinator.server.sockets.sockets.get(delayed.id).data.identity.expiresAt =
      Date.now() - 1;
    const delayedDisconnect = nextEvent(delayed, 'disconnect');
    await broadcast.emitToBoard(ids.a, 'test:board', { sequence: 4 });
    await delayedDisconnect;
    assert.deepEqual(delayedValues, []);
    check(
      'broadcast excludes expired connections even before their timer fires',
    );

    await request(app.getHttpServer())
      .delete(`/api/boards/${ids.a}/members/${ids.member}`)
      .set('Authorization', `Bearer ${tokens.other}`)
      .expect(404);
    assert.equal(
      coordinator.server.sockets.sockets.get(member.id).rooms.has(room(ids.a)),
      true,
    );
    check('failed REST removal leaves legitimate room access intact');

    // Pause *after* persistence succeeds but *before* the remove service resumes.
    // Broadcast/join must not overtake post-commit eviction in that exact gap.
    const committed = deferred();
    const release = deferred();
    const transaction = source.manager.transaction;
    source.manager.transaction = async function (...args) {
      const result = await transaction.apply(this, args);
      committed.resolve();
      await release.promise;
      return result;
    };
    const removal = request(app.getHttpServer())
      .delete(`/api/boards/${ids.a}/members/${ids.member}`)
      .set('Authorization', `Bearer ${tokens.owner}`)
      .expect(204)
      .then((value) => value);
    try {
      await Promise.race([
        committed.promise,
        removal.then(() => {
          throw new Error('Removal did not enter transaction');
        }),
      ]);
      const before = [...received.get(member)];
      const beforeTab = [...received.get(memberTab)];
      let emitted = false;
      const emitting = broadcast
        .emitToBoard(ids.a, 'test:board', { sequence: 5 })
        .then(() => {
          emitted = true;
        });
      const rejoining = ack(member, 'board:join', { boardId: ids.a });
      await broadcast.emitToBoard(ids.b, 'test:board', { sequence: 6 });
      assert.equal(emitted, false);
      release.resolve();
      await Promise.all([removal, emitting]);
      assert.equal((await rejoining).code, 'NOT_FOUND');
      await flush([...received.keys()]);
      assert.deepEqual(received.get(member), [...before, 6]);
      assert.deepEqual(received.get(memberTab), beforeTab);
      assert.equal(
        coordinator.server.sockets.sockets
          .get(member.id)
          .rooms.has(room(ids.a)),
        false,
      );
      assert.equal(
        coordinator.server.sockets.sockets
          .get(memberTab.id)
          .rooms.has(room(ids.a)),
        false,
      );
      assert.equal(
        coordinator.server.sockets.sockets
          .get(member.id)
          .rooms.has(room(ids.b)),
        true,
      );
    } finally {
      source.manager.transaction = transaction;
      release.resolve();
      await removal;
    }
    check(
      'REST commit -> all user sockets evicted -> concurrent broadcast/join; other boards continue',
    );

    const afterRemoval = await connect(tokens.member);
    assert.equal(
      (await ack(afterRemoval, 'board:join', { boardId: ids.a })).code,
      'NOT_FOUND',
    );
    await join(afterRemoval, ids.b);
    const afterRemovalValues = [];
    afterRemoval.on('test:board', (value) => afterRemovalValues.push(value));
    await broadcast.emitToBoard(ids.a, 'test:board', { sequence: 7 });
    await flush([afterRemoval]);
    assert.deepEqual(afterRemovalValues, []);
    check(
      'reconnecting after membership revocation cannot regain the removed board',
    );

    const beforeOwner = [...received.get(owner)];
    member.emit('test:board', { sequence: 1000 });
    await flush([owner, member]);
    assert.deepEqual(received.get(owner), beforeOwner);
    check('client cannot invoke generic server-side broadcast');

    // Exhaust the user's window using both event types and different boards.
    for (let index = 0; index < 60; index++) {
      const boardId = `${index.toString(16).padStart(8, '0')}${ids.empty.slice(8)}`;
      const result = await ack(
        index % 2 ? other : unauthorized,
        index % 2 ? 'board:join' : 'board:leave',
        { boardId },
      );
      assert.ok(
        result.success ||
          ['NOT_FOUND', 'TOO_MANY_REQUESTS'].includes(result.code),
      );
    }
    const burst = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        ack(
          index % 2 ? other : unauthorized,
          index % 2 ? 'board:join' : 'board:leave',
          { boardId: ids.b },
        ),
      ),
    );
    assert.ok(burst.every((result) => result.code === 'TOO_MANY_REQUESTS'));
    const reconnectedLimited = await connect(tokens.other);
    assert.equal(
      (await ack(reconnectedLimited, 'board:join', { boardId: ids.b })).code,
      'TOO_MANY_REQUESTS',
    );
    check(
      'join/leave flood acknowledged safely; board changes, tabs and reconnect cannot bypass quota',
    );
    return passed.length;
  } finally {
    for (const socket of clients) socket.close();
  }
}
