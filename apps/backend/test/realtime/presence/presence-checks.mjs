import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { ids } from '../realtime-checks.mjs';
import { nextBoardEvent } from '../board-events/board-events-checks.mjs';

const require = createRequire(import.meta.url);
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { io } = createRequire(
  new URL('../../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const {
  BoardRoomCoordinator,
} = require('../../../src/realtime/board-room-coordinator.service.ts');
const {
  BoardPresenceService,
} = require('../../../src/realtime/board-presence.service.ts');

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
const bounded = async (promise) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Presence barrier timed out')),
          8000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export async function runPresenceChecks(app, source, databaseMode) {
  const clients = [],
    received = new Map(),
    tokens = {};
  const coordinator = app.get(BoardRoomCoordinator),
    presence = app.get(BoardPresenceService);
  let count = 0;
  const pass = (name) => {
    count++;
    console.log(`PASS: ${name}`);
  };
  const ack = (socket, event, boardId) =>
    socket.timeout(5000).emitWithAck(event, { boardId });
  const connect = async (token, reject = false) => {
    const socket = io(await app.getUrl(), {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: token },
    });
    clients.push(socket);
    received.set(socket, []);
    socket.on('presence:sync', (snapshot) =>
      received.get(socket).push(snapshot),
    );
    const ready = nextBoardEvent(socket, reject ? 'connect_error' : 'connect');
    socket.connect();
    const result = await ready;
    if (reject) {
      assert.equal(result.data.code, 'UNAUTHORIZED');
      socket.close();
    }
    return socket;
  };
  const join = async (socket, boardId) => {
    const before = received.get(socket).length;
    assert.deepEqual(await ack(socket, 'board:join', boardId), {
      success: true,
      boardId: boardId.toLowerCase(),
    });
    // On one transport the snapshot is received before the ACK resolves.
    assert.equal(received.get(socket).length, before + 1);
    assert.equal(received.get(socket).at(-1).boardId, boardId.toLowerCase());
  };
  const flush = () =>
    Promise.all(
      clients
        .filter((s) => s.connected)
        .map((s) => ack(s, 'board:leave', ids.empty)),
    );
  const sizes = () => clients.map((s) => received.get(s).length);
  const http = (method, target, status, token = tokens.owner) => {
    const agent = request(app.getHttpServer());
    return agent[method](`/api/boards/${ids.a}/members/${target}`)
      .auth(token, { type: 'bearer' })
      .expect(status);
  };
  const expected = (boardId, userIds) => ({
    boardId,
    userIds: [...userIds].sort(),
  });
  let committedRemoval = () => http('delete', ids.member.toUpperCase(), 204);
  try {
    for (const name of ['owner', 'member', 'other']) {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: `${name}@events.test`,
          password: 'board-events-password',
        })
        .expect(200);
      tokens[name] = response.body.data.accessToken;
    }
    await connect('invalid', true);
    const jwt = app.get(JwtService);
    await connect(
      await jwt.signAsync({ sub: ids.member }, { expiresIn: -1 }),
      true,
    );
    const owner = await connect(tokens.owner),
      member = await connect(tokens.member),
      tab = await connect(tokens.member),
      other = await connect(tokens.other);
    assert.equal(
      (await ack(owner, 'board:join', 'invalid')).code,
      'VALIDATION_FAILED',
    );
    assert.equal((await ack(other, 'board:join', ids.a)).code, 'NOT_FOUND');
    await flush();
    assert.ok(sizes().every((size) => size === 0));
    pass(
      'invalid/expired JWT, invalid UUID and nonmember cannot receive presence',
    );

    await join(owner, ids.a.toUpperCase());
    assert.deepEqual(received.get(owner).at(-1), expected(ids.a, [ids.owner]));
    const both = nextBoardEvent(owner, 'presence:sync');
    await join(member, ids.a);
    assert.deepEqual(await both, expected(ids.a, [ids.owner, ids.member]));
    await join(other, ids.b);
    await flush();
    assert.deepEqual(received.get(other), [expected(ids.b, [ids.other])]);
    assert.equal(received.get(tab).length, 0);
    pass(
      'canonical initial full snapshot precedes ACK; multiple users and board isolation',
    );

    await join(tab, ids.a);
    await join(tab, ids.a);
    await flush();
    assert.deepEqual(
      received.get(owner).at(-1),
      expected(ids.a, [ids.owner, ids.member]),
    );
    assert.equal((await ack(member, 'board:leave', ids.a)).success, true);
    await flush();
    assert.deepEqual(
      received.get(owner).at(-1),
      expected(ids.a, [ids.owner, ids.member]),
    );
    assert.equal((await ack(tab, 'board:leave', ids.a)).success, true);
    await flush();
    assert.deepEqual(received.get(owner).at(-1), expected(ids.a, [ids.owner]));
    await ack(tab, 'board:leave', ids.a);
    pass(
      'multi-tab and duplicate join/leave retain a user until their last tab leaves',
    );

    await join(member, ids.a);
    const oldId = member.id;
    const disconnected = nextBoardEvent(owner, 'presence:sync');
    member.close();
    assert.deepEqual(await disconnected, expected(ids.a, [ids.owner]));
    assert.deepEqual(presence.boardIds(oldId), []);
    member.auth = { accessToken: tokens.member };
    const ready = nextBoardEvent(member, 'connect');
    member.connect();
    await ready;
    assert.notEqual(member.id, oldId);
    await flush();
    assert.deepEqual(received.get(owner).at(-1), expected(ids.a, [ids.owner]));
    await join(member, ids.a);
    await join(tab, ids.a);
    pass(
      'disconnect without leave cleans registry; reconnect requires a fresh authorized join',
    );

    const short = await connect(
      await jwt.signAsync({ sub: ids.member }, { expiresIn: 2 }),
    );
    await join(short, ids.b);
    const shortId = short.id;
    // Consume the join snapshot on the other transport before awaiting expiry.
    await flush();
    const expired = nextBoardEvent(short, 'disconnect');
    const expiredPresence = nextBoardEvent(other, 'presence:sync');
    assert.deepEqual(await expiredPresence, expected(ids.b, [ids.other]));
    await expired;
    assert.deepEqual(presence.boardIds(shortId), []);
    pass('real JWT expiry disconnects the last tab and removes ghost presence');

    const beforeRejected = sizes();
    await http('delete', ids.owner, 403, tokens.member);
    await http('delete', ids.owner, 409);
    await flush();
    assert.deepEqual(sizes(), beforeRejected);
    assert.deepEqual(
      presence.snapshot(ids.a),
      expected(ids.a, [ids.owner, ids.member]),
    );
    pass(
      'rejected owner/member removal preserves all presence and receive grants',
    );

    if (databaseMode) {
      const originalCreateRunner = source.createQueryRunner;
      const gatedRemoval = async (rollback) => {
        const entered = deferred(),
          release = deferred();
        const before = sizes();
        source.createQueryRunner = function (...args) {
          const runner = originalCreateRunner.apply(this, args);
          const commit = runner.commitTransaction.bind(runner);
          runner.commitTransaction = async () => {
            if (runner.transactionDepth === 1) {
              entered.resolve();
              await release.promise;
              if (rollback) throw new Error('injected COMMIT failure');
            }
            return commit();
          };
          return runner;
        };
        const mutation = http('delete', ids.member, rollback ? 500 : 204).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        try {
          await bounded(
            Promise.race([
              entered.promise,
              mutation.then((result) => {
                throw result.error ?? new Error('No commit reached');
              }),
            ]),
          );
          // Fresh connection sees the previous committed membership.
          assert.equal(
            await source
              .getRepository('BoardMember')
              .count({ where: { boardId: ids.a, userId: ids.member } }),
            1,
          );
          await flush();
          assert.deepEqual(sizes(), before);
          for (const socket of [member, tab])
            assert.equal(
              coordinator.server.sockets.sockets
                .get(socket.id)
                .data.authorizedBoardIds.has(ids.a),
              true,
            );
        } finally {
          release.resolve();
          source.createQueryRunner = originalCreateRunner;
        }
        const result = await mutation;
        if (result.error) throw result.error;
        if (rollback) {
          await flush();
          assert.deepEqual(sizes(), before);
          assert.equal(
            await source
              .getRepository('BoardMember')
              .count({ where: { boardId: ids.a, userId: ids.member } }),
            1,
          );
          assert.deepEqual(
            presence.snapshot(ids.a),
            expected(ids.a, [ids.owner, ids.member]),
          );
        }
      };
      await gatedRemoval(true);
      pass(
        'real COMMIT failure rolls back membership and leaves presence/grants unchanged',
      );
      // Successful commit is gated later, including the failing transport path.
      committedRemoval = () => gatedRemoval(false);
    }

    await join(member, ids.b);
    await join(tab, ids.b);
    const ownerTab = await connect(tokens.owner);
    await join(ownerTab, ids.a);
    await flush();
    const originals = [member, tab, ownerTab].map((client) => {
      const socket = coordinator.server.sockets.sockets.get(client.id);
      return {
        socket,
        leave: socket.leave,
        disconnect: socket.disconnect,
        emit: socket.emit,
      };
    });
    const revokedBefore = [
      received.get(member).length,
      received.get(tab).length,
    ];
    const ordering = [];
    const recordPresence = () => ordering.push('presence');
    const recordRemoval = () => ordering.push('removed');
    owner.on('presence:sync', recordPresence);
    owner.on('member:removed', recordRemoval);
    const removalSnapshot = nextBoardEvent(owner, 'presence:sync');
    const removalEvent = nextBoardEvent(owner, 'member:removed');
    try {
      for (const { socket, leave } of originals.slice(0, 2)) {
        socket.leave = async (room) => {
          if (room === `board:${ids.a}`)
            throw new Error('injected leave failure');
          return leave.call(socket, room);
        };
        socket.disconnect = () => {
          throw new Error('injected disconnect failure');
        };
      }
      const broken = originals[2];
      broken.socket.emit = function (event, ...args) {
        if (event === 'presence:sync')
          throw new Error('injected presence emit failure');
        return broken.emit.call(this, event, ...args);
      };
      if (databaseMode) {
        await committedRemoval();
        pass(
          'successful SQL removal cannot revoke or deliver before COMMIT resolves',
        );
      } else await committedRemoval();
      assert.deepEqual(await removalSnapshot, expected(ids.a, [ids.owner]));
      assert.deepEqual(await removalEvent, {
        boardId: ids.a,
        userId: ids.member,
      });
      await flush();
      assert.deepEqual(ordering, ['presence', 'removed']);
      assert.deepEqual(
        [received.get(member).length, received.get(tab).length],
        revokedBefore,
      );
      for (const { socket } of originals.slice(0, 2)) {
        assert.equal(socket.data.authorizedBoardIds.has(ids.a), false);
        assert.equal(socket.rooms.has(`board:${ids.a}`), true);
        assert.equal(socket.data.authorizedBoardIds.has(ids.b), true);
      }
      assert.deepEqual(
        presence.snapshot(ids.b),
        expected(ids.b, [ids.member, ids.other]),
      );
      assert.equal(
        await source
          .getRepository('BoardMember')
          .count({ where: { boardId: ids.a, userId: ids.member } }),
        0,
      );
      assert.equal((await ack(tab, 'board:join', ids.a)).code, 'NOT_FOUND');
      pass(
        'post-commit eviction removes every tab, excludes revoked recipients and isolates emit/adapter failures',
      );
    } finally {
      owner.off('presence:sync', recordPresence);
      owner.off('member:removed', recordRemoval);
      for (const { socket, leave, disconnect, emit } of originals)
        Object.assign(socket, { leave, disconnect, emit });
    }

    const allLeaving = [owner, ownerTab].map((s) =>
      ack(s, 'board:leave', ids.a),
    );
    await Promise.all(allLeaving);
    await Promise.all(
      [member, tab, other].map((s) => ack(s, 'board:leave', ids.b)),
    );
    await flush();
    assert.equal(presence.boards.size, 0);
    assert.equal(presence.sockets.size, 0);
    assert.equal(coordinator.pending.size, 0);
    pass(
      'last viewers leave no board/socket indices or pending coordinator operations',
    );
    return count;
  } finally {
    for (const client of clients) client.close();
  }
}
